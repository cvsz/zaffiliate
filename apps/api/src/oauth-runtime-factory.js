import { createOAuthFlow } from '../../../packages/security/src/oauth.js';
import { createUrlValidator } from '../../../packages/security/src/url-validation.js';

const MAX_TOKEN_RESPONSE_BYTES = 1024 * 1024;

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

function responseTooLarge() {
  const error = new Error('oauth token response exceeded 1MB');
  error.code = 'OAUTH_TOKEN_RESPONSE_TOO_LARGE';
  return error;
}

async function readTokenResponseBounded(response) {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_TOKEN_RESPONSE_BYTES) throw responseTooLarge();

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
        if (total > MAX_TOKEN_RESPONSE_BYTES) {
          try { await reader.cancel('oauth token response too large'); } catch {}
          throw responseTooLarge();
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return Buffer.concat(chunks, total).toString('utf8');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_TOKEN_RESPONSE_BYTES) throw responseTooLarge();
  return text;
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
  const endpointValidator = createUrlValidator({
    allowedSchemes: ['https'],
    blockPrivateRanges: true,
    allowedHosts: [new URL(tokenUrl).hostname]
  });

  const transport = async (request) => {
    endpointValidator.validate(String(request?.url ?? ''), 'oauth token request');
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: request.method ?? 'POST',
        headers: request.headers ?? {},
        body: request.body ?? null,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      const text = await readTokenResponseBounded(response);
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      return { status: response.status, json, text };
    } catch (error) {
      if (error?.code === 'OAUTH_TOKEN_RESPONSE_TOO_LARGE') throw error;
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
    clock
  });

  return new Map([[provider, Object.freeze({ provider, issuer, flow })]]);
}
