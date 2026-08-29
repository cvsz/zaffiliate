import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createRequire } from 'node:module';
import { createJwksClient, verifyJwt } from '../packages/security/src/jwks.js';

const require = createRequire(import.meta.url);

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwkPublic = publicKey.export({ format: 'jwk' });
const KID = 'test-key-1';

function b64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function signToken(payload, { kid = KID, alg = 'RS256', key = privateKey } = {}) {
  const header = b64url({ alg, typ: 'JWT', ...(kid ? { kid } : {}) });
  const body = b64url(payload);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${body}`), key).toString('base64url');
  return `${header}.${body}.${signature}`;
}


const JWKS = { keys: [{ ...jwkPublic, kid: KID, use: 'sig', alg: 'RS256' }] };
const NOW_SECONDS = Math.floor(new Date('2026-08-24T12:00:00Z').getTime() / 1000);

const FIXED_CLOCK_MS = new Date('2026-08-24T12:00:00Z').getTime();

function clientWith(jwksResponses) {
  let calls = 0;
  const fetchImpl = async () => {
    const payload = jwksResponses[Math.min(calls, jwksResponses.length - 1)];
    calls += 1;
    return { ok: true, json: async () => payload };
  };
  return { client: createJwksClient({ jwksUri: 'https://issuer/.well-known/jwks.json', fetchImpl, clock: () => FIXED_CLOCK_MS }), calls: () => calls };
}

const CLAIMS = {
  sub: 'user-1', iss: 'https://issuer/', aud: 'zaffiliate-api',
  exp: NOW_SECONDS + 600, iat: NOW_SECONDS - 10
};

test('valid RS256 tokens verify against cached JWKS with full claim checks', async () => {
  const { client } = clientWith([JWKS]);
  const token = signToken(CLAIMS);
  const result = await verifyJwt({
    token, jwksClient: client,
    issuer: 'https://issuer/', audience: 'zaffiliate-api', nowSeconds: NOW_SECONDS
  });
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, 'user-1');
});

test('tampered payloads fail signature verification', async () => {
  const { client } = clientWith([JWKS]);
  const token = signToken(CLAIMS);
  const parts = token.split('.');
  const forged = `${parts[0]}.${b64url({ ...CLAIMS, sub: 'attacker' })}.${parts[2]}`;
  const result = await verifyJwt({ token: forged, jwksClient: client, issuer: 'https://issuer/', audience: 'zaffiliate-api', nowSeconds: NOW_SECONDS });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature_verification_failed');
});

test('expired, wrong-audience and wrong-issuer tokens fail closed with reasons', async () => {
  const { client } = clientWith([JWKS]);
  for (const [payload, reason] of [
    [{ ...CLAIMS, exp: NOW_SECONDS - 1 }, 'token_expired'],
    [{ ...CLAIMS, aud: 'other-api' }, 'audience_mismatch'],
    [{ ...CLAIMS, iss: 'https://evil/' }, 'issuer_mismatch']
  ]) {
    const result = await verifyJwt({
      token: signToken(payload), jwksClient: client,
      issuer: 'https://issuer/', audience: 'zaffiliate-api', nowSeconds: NOW_SECONDS
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, reason);
  }
});

test('unknown kid triggers exactly one JWKS refresh then fails closed if still absent', async () => {
  const { client, calls } = clientWith([JWKS]);
  const stranger = signToken(CLAIMS, { kid: 'stranger-key' });
  const first = await verifyJwt({ token: stranger, jwksClient: client, issuer: 'https://issuer/', audience: 'a', nowSeconds: NOW_SECONDS });
  assert.equal(first.valid, false);
  assert.equal(first.reason, 'unknown_kid');
  assert.equal(calls(), 2, 'one cache warm + one forced refresh');

  const second = await verifyJwt({ token: stranger, jwksClient: client, issuer: 'https://issuer/', audience: 'a', nowSeconds: NOW_SECONDS });
  assert.equal(second.valid, false);
  assert.equal(calls(), 2, 'refresh must not loop per request');
});

test('alg=none and symmetric algs are rejected regardless of key material', async () => {
  const { client } = clientWith([JWKS]);
  const header = b64url({ alg: 'none', typ: 'JWT' });
  const body = b64url(CLAIMS);
  const result = await verifyJwt({ token: `${header}.${body}.`, jwksClient: client, issuer: 'https://issuer/', audience: 'a', nowSeconds: NOW_SECONDS });
  assert.equal(result.valid, false);
  assert.match(result.reason, /algorithm/i);

  const hsHeader = b64url({ alg: 'HS256', typ: 'JWT', kid: KID });
  const hsResult = await verifyJwt({
    token: `${hsHeader}.${body}.${b64url({ x: 1 })}`, jwksClient: client,
    issuer: 'https://issuer/', audience: 'a', nowSeconds: NOW_SECONDS
  });
  assert.equal(hsResult.valid, false);
  assert.match(hsResult.reason, /algorithm/i);
});
