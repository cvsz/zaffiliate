import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createOAuthRegistryForEnv } from '../apps/api/src/oauth-runtime-factory.js';

const NOW = 1_760_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'oidc-key-1', use: 'sig', alg: 'RS256' };

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function idToken(claims) {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: jwk.kid });
  const payload = encode(claims);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function env(overrides = {}) {
  return {
    OAUTH_PROVIDER_ID: 'oidc',
    OAUTH_CLIENT_ID: 'client-id',
    OAUTH_CLIENT_SECRET: 'client-secret',
    OAUTH_AUTHORIZE_URL: 'https://issuer.example/authorize',
    OAUTH_TOKEN_URL: 'https://issuer.example/token',
    OAUTH_REDIRECT_URI: 'https://app.example/api/v1/oauth/oidc/callback',
    OAUTH_ISSUER: 'https://issuer.example/',
    OAUTH_SCOPE: 'openid profile email',
    OAUTH_JWKS_URI: 'https://issuer.example/.well-known/jwks.json',
    ...overrides
  };
}

function jsonResponse(status, document) {
  const text = JSON.stringify(document);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return String(name).toLowerCase() === 'content-length' ? String(Buffer.byteLength(text)) : null; } },
    body: null,
    async text() { return text; }
  };
}

test('OIDC mode sends nonce and binds external identity to verified RS256 claims', async () => {
  let expectedNonce = null;
  const fetchImpl = async (url) => {
    if (url === 'https://issuer.example/token') {
      return jsonResponse(200, {
        access_token: 'access-token',
        id_token: idToken({
          iss: 'https://issuer.example/',
          aud: 'client-id',
          sub: 'verified-subject-42',
          email: 'Verified.User@Example.Test',
          email_verified: true,
          nonce: expectedNonce,
          iat: NOW_SECONDS - 5,
          exp: NOW_SECONDS + 600
        }),
        expires_in: 3600,
        token_type: 'Bearer'
      });
    }
    if (url === 'https://issuer.example/.well-known/jwks.json') {
      return jsonResponse(200, { keys: [jwk] });
    }
    throw new Error(`unexpected provider URL ${url}`);
  };

  const registry = createOAuthRegistryForEnv({ env: env(), fetchImpl, clock: () => NOW });
  const entry = registry.get('oidc');
  assert.equal(typeof entry.verifyIdentity, 'function');
  assert.equal(typeof entry.verifyIdentityClaims, 'function');

  const authorization = entry.flow.createAuthorization();
  expectedNonce = authorization.nonce;
  assert.match(expectedNonce, /^[A-Za-z0-9_-]{16,}$/);
  assert.equal(new URL(authorization.url).searchParams.get('nonce'), expectedNonce);

  const tokens = await entry.flow.exchangeCode({ authorization, code: 'grant-1' });
  assert.ok(tokens.idToken);
  assert.equal(await entry.verifyIdentity({ tokens, nonce: expectedNonce }), 'verified-subject-42');
  assert.deepEqual(await entry.verifyIdentityClaims({ tokens, nonce: expectedNonce }), {
    subject: 'verified-subject-42',
    email: 'verified.user@example.test',
    emailVerified: true
  });

  await assert.rejects(
    () => entry.verifyIdentity({ tokens, nonce: 'wrong-nonce-value-12345' }),
    (error) => error.code === 'OIDC_ID_TOKEN_INVALID'
  );
});

test('OIDC mode fails closed when id_token is missing, expired, or lacks exp', async () => {
  let responseClaims = null;
  const fetchImpl = async (url) => {
    if (url.endsWith('/token')) {
      return jsonResponse(200, {
        access_token: 'access-token',
        ...(responseClaims ? { id_token: idToken(responseClaims) } : {})
      });
    }
    return jsonResponse(200, { keys: [jwk] });
  };
  const registry = createOAuthRegistryForEnv({ env: env(), fetchImpl, clock: () => NOW });
  const entry = registry.get('oidc');
  const authorization = entry.flow.createAuthorization();

  let tokens = await entry.flow.exchangeCode({ authorization, code: 'g1' });
  await assert.rejects(() => entry.verifyIdentity({ tokens, nonce: authorization.nonce }), (error) => error.code === 'OIDC_ID_TOKEN_INVALID');

  responseClaims = {
    iss: 'https://issuer.example/', aud: 'client-id', sub: 'u1', nonce: authorization.nonce,
    exp: NOW_SECONDS - 1
  };
  tokens = await entry.flow.exchangeCode({ authorization, code: 'g2' });
  await assert.rejects(() => entry.verifyIdentity({ tokens, nonce: authorization.nonce }), (error) => error.code === 'OIDC_ID_TOKEN_INVALID');

  responseClaims = {
    iss: 'https://issuer.example/', aud: 'client-id', sub: 'u1', nonce: authorization.nonce
  };
  tokens = await entry.flow.exchangeCode({ authorization, code: 'g3' });
  await assert.rejects(() => entry.verifyIdentity({ tokens, nonce: authorization.nonce }), (error) => error.code === 'OIDC_ID_TOKEN_INVALID');
});

test('OIDC verified claims discard malformed email and never elevate email verification without a usable signed email', async () => {
  let nonce;
  const fetchImpl = async (url) => {
    if (url.endsWith('/token')) {
      return jsonResponse(200, {
        access_token: 'access-token',
        id_token: idToken({
          iss: 'https://issuer.example/', aud: 'client-id', sub: 'subject-no-email',
          email: 'not-an-email', email_verified: true, nonce, exp: NOW_SECONDS + 600
        })
      });
    }
    return jsonResponse(200, { keys: [jwk] });
  };
  const registry = createOAuthRegistryForEnv({ env: env(), fetchImpl, clock: () => NOW });
  const entry = registry.get('oidc');
  const authorization = entry.flow.createAuthorization();
  nonce = authorization.nonce;
  const tokens = await entry.flow.exchangeCode({ authorization, code: 'g4' });
  const claims = await entry.verifyIdentityClaims({ tokens, nonce });
  assert.equal(claims.subject, 'subject-no-email');
  assert.equal(claims.email, null);
  assert.equal(claims.emailVerified, true, 'claim fidelity is preserved; login boundary separately requires a usable email before marking the local user verified');
});

test('OIDC configuration requires openid scope and a public HTTPS JWKS endpoint', () => {
  assert.throws(
    () => createOAuthRegistryForEnv({ env: env({ OAUTH_SCOPE: 'profile email' }), fetchImpl: async () => {} }),
    (error) => error.code === 'OIDC_SCOPE_REQUIRED'
  );
  assert.throws(
    () => createOAuthRegistryForEnv({ env: env({ OAUTH_JWKS_URI: 'https://127.0.0.1/jwks.json' }), fetchImpl: async () => {} }),
    (error) => error.code === 'SSRF_BLOCKED'
  );
});
