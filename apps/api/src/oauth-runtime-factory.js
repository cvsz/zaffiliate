import { createOAuthFlow } from '../../../packages/security/src/oauth.js';
import { createJwksClient, verifyJwt } from '../../../packages/security/src/jwks.js';
import { createUrlValidator } from '../../../packages/security/src/url-validation.js';

const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

function required(env, key) {
  const value = String(env?.[key] ?? '').trim();
  if (!value) {
    const error = new Error(`${key} is required when OAUTH_PROVIDER_ID is configured`);
    error.code = 'OAUTH_CONFIG_INCOMPLETE';
    throw error;
  }
  return value;
}

function publicHttps(value, label) {
  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(value, label);
  return new URL(value).toString();
}

function responseTooLarge(label) {
  const error = new Error(`${label} exceeded 1MB`);
  error.code = 'OAUTH_PROVIDER_RESPONSE_TOO_LARGE';
  return error;
}

async function readResponseBounded(response, label) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_RESPONSE_BYTES) throw responseTooLarge(label);

  const body = response?.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > MAX_PROVIDER_RESPONSE_BYTES) {
          try { await reader.cancel(`${label} too large`); } catch {}
          throw responseTooLarge(label);
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES) throw responseTooLarge(label);
  return text;
}

function providerFetch({ fetchImpl, allowedUrl, label }) {
  const validator = createUrlValidator({
    allowedSchemes: ['https'],
    blockPrivateRanges: true,
    allowedHosts: [new URL(allowedUrl).hostname]
  });
  return async (url, init = {}) => {
    validator.validate(String(url ?? ''), label);
    return fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(10_000)
    });
  };
}

function verifiedEmail(claims) {
  const email = String(claims?.email ?? '').trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function createOAuthRegistryForEnv({ env = process.env, fetchImpl = globalThis.fetch, clock = () => Date.now() } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const provider = String(env?.OAUTH_PROVIDER_ID ?? '').trim().toLowerCase();
  if (!provider) return new Map();
  if (!/^[a-z0-9_-]{2,32}$/.test(provider)) throw new Error('OAUTH_PROVIDER_ID must be 2-32 chars of a-z0-9_-');

  const clientId = required(env, 'OAUTH_CLIENT_ID');
  const clientSecret = required(env, 'OAUTH_CLIENT_SECRET');
  const authorizeUrl = publicHttps(required(env, 'OAUTH_AUTHORIZE_URL'), 'oauth authorize endpoint');
  const tokenUrl = publicHttps(required(env, 'OAUTH_TOKEN_URL'), 'oauth token endpoint');
  const redirectUri = publicHttps(required(env, 'OAUTH_REDIRECT_URI'), 'oauth redirect uri');
  const issuer = publicHttps(required(env, 'OAUTH_ISSUER'), 'oauth issuer');
  const scope = String(env?.OAUTH_SCOPE ?? '').trim();
  const jwksRaw = String(env?.OAUTH_JWKS_URI ?? '').trim();
  const jwksUri = jwksRaw ? publicHttps(jwksRaw, 'oauth jwks endpoint') : null;
  if (jwksUri && !scope.split(/\s+/).includes('openid')) {
    const error = new Error('OAUTH_SCOPE must include openid when OAUTH_JWKS_URI is configured');
    error.code = 'OIDC_SCOPE_REQUIRED';
    throw error;
  }

  const tokenFetch = providerFetch({ fetchImpl, allowedUrl: tokenUrl, label: 'oauth token request' });
  const transport = async (request) => {
    let response;
    try {
      response = await tokenFetch(request.url, {
        method: request.method ?? 'POST',
        headers: request.headers ?? {},
        body: request.body ?? null
      });
      const text = await readResponseBounded(response, 'oauth token response');
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      return { status: response.status, json, text };
    } catch (error) {
      if (error?.code === 'OAUTH_PROVIDER_RESPONSE_TOO_LARGE') throw error;
      const wrapped = new Error('oauth token transport failed');
      wrapped.code = 'OAUTH_TRANSPORT_FAILED';
      wrapped.cause = error;
      throw wrapped;
    }
  };

  const flow = createOAuthFlow({
    provider,
    clientId,
    clientSecret,
    authorizeUrl,
    tokenUrl,
    redirectUri,
    scope,
    transport,
    useNonce: Boolean(jwksUri),
    clock
  });

  let verifyIdentity = null;
  let verifyIdentityClaims = null;
  if (jwksUri) {
    const jwksFetch = providerFetch({ fetchImpl, allowedUrl: jwksUri, label: 'oauth jwks request' });
    const jwksClient = createJwksClient({
      jwksUri,
      clock,
      fetchImpl: async (url) => {
        const response = await jwksFetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) throw new Error(`jwks fetch failed with ${response.status}`);
        const text = await readResponseBounded(response, 'oauth jwks response');
        let document;
        try { document = JSON.parse(text); } catch { throw new Error('invalid JWKS document'); }
        return document;
      }
    });
    verifyIdentityClaims = async ({ tokens, nonce }) => {
      if (!tokens?.idToken || !nonce) {
        const error = new Error('OIDC identity token or nonce missing');
        error.code = 'OIDC_ID_TOKEN_INVALID';
        throw error;
      }
      const verification = await verifyJwt({
        token: tokens.idToken,
        jwksClient,
        issuer,
        audience: clientId,
        nonce,
        nowSeconds: Math.floor(clock() / 1000)
      });
      const claims = verification?.claims ?? {};
      const subject = String(claims.sub ?? '').trim();
      if (!verification.valid || !Number.isFinite(claims.exp) || !subject || subject.length > 1024) {
        const reason = verification.valid && !Number.isFinite(claims.exp) ? 'exp_missing' : (verification.reason ?? 'subject_missing');
        const error = new Error(`OIDC identity verification failed (${reason})`);
        error.code = 'OIDC_ID_TOKEN_INVALID';
        throw error;
      }
      return Object.freeze({
        subject,
        email: verifiedEmail(claims),
        emailVerified: claims.email_verified === true
      });
    };
    verifyIdentity = async (input) => (await verifyIdentityClaims(input)).subject;
  }

  return new Map([[
    provider,
    Object.freeze({
      provider,
      issuer,
      flow,
      ...(verifyIdentity ? { verifyIdentity, verifyIdentityClaims } : {})
    })
  ]]);
}
