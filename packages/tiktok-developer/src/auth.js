import { createHash, randomBytes } from 'node:crypto';
import { createUrlValidator } from '../../security/src/url-validation.js';

export const TIKTOK_AUTH_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_REVOKE_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/revoke/';
export const TIKTOK_USER_INFO_ENDPOINT = 'https://open.tiktokapis.com/v2/user/info/';

export const DEFAULT_TIKTOK_SCOPES = Object.freeze(['user.info.basic', 'video.publish', 'video.upload']);

export class TikTokOAuthError extends Error {
  constructor(message, { code = 'TIKTOK_OAUTH_FAILED', providerCode = null, httpStatus = null } = {}) {
    super(message);
    this.name = 'TikTokOAuthError';
    this.code = code;
    this.providerCode = providerCode;
    this.httpStatus = httpStatus;
  }
}

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function base64url(buffer) {
  return buffer.toString('base64url');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest();
}

export function generatePkceBundle(randomBytesFn = randomBytes) {
  const verifier = base64url(randomBytesFn(48));
  const challenge = base64url(sha256(Buffer.from(verifier, 'utf8')));
  return Object.freeze({
    codeVerifier: verifier,
    codeChallenge: challenge,
    codeChallengeMethod: 'S256'
  });
}

export function generateOAuthState(randomBytesFn = randomBytes) {
  return base64url(randomBytesFn(24));
}

export function buildTikTokAuthorizationUrl({
  clientKey,
  redirectUri,
  scopes = DEFAULT_TIKTOK_SCOPES,
  state,
  codeChallenge,
  authEndpoint = TIKTOK_AUTH_ENDPOINT
}) {
  const key = requiredString(clientKey, 'clientKey');
  const redirect = requiredString(redirectUri, 'redirectUri');
  const csrfState = requiredString(state, 'state');
  const challenge = requiredString(codeChallenge, 'codeChallenge');

  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(redirect, 'redirectUri');
  validator.validate(authEndpoint, 'authEndpoint');

  const scopeList = Array.isArray(scopes) ? scopes.join(',') : String(scopes || '').trim();
  if (!scopeList) throw new TypeError('scopes must be a non-empty array or string');

  const url = new URL(authEndpoint);
  url.searchParams.set('client_key', key);
  url.searchParams.set('scope', scopeList);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', csrfState);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

export function normalizeTikTokTokenPayload(payload, clock = Date.now) {
  if (!payload || typeof payload !== 'object') {
    throw new TikTokOAuthError('empty token response payload', { code: 'INVALID_TOKEN_RESPONSE' });
  }

  const err = payload.error;
  if (err && err.code && err.code !== 'ok' && err.code !== '0') {
    throw new TikTokOAuthError(String(err.message || 'TikTok token request rejected'), {
      code: 'TIKTOK_PROVIDER_ERROR',
      providerCode: String(err.code)
    });
  }

  const data = payload.data || payload;
  const accessToken = requiredString(data.access_token, 'access_token');
  const refreshToken = data.refresh_token ? String(data.refresh_token).trim() : null;
  const openId = requiredString(data.open_id, 'open_id');
  const expiresIn = Number(data.expires_in ?? 86400);
  const refreshExpiresIn = Number(data.refresh_expires_in ?? 31536000);
  const now = clock();

  return Object.freeze({
    accessToken,
    refreshToken,
    openId,
    scope: data.scope ? String(data.scope) : null,
    tokenType: data.token_type ? String(data.token_type) : 'Bearer',
    expiresIn,
    refreshExpiresIn,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
    refreshExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : null
  });
}

export async function exchangeTikTokCode({
  clientKey,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
  tokenEndpoint = TIKTOK_TOKEN_ENDPOINT,
  transport = fetch,
  clock = Date.now
}) {
  const key = requiredString(clientKey, 'clientKey');
  const secret = requiredString(clientSecret, 'clientSecret');
  const authCode = requiredString(code, 'code');
  const redirect = requiredString(redirectUri, 'redirectUri');
  const verifier = requiredString(codeVerifier, 'codeVerifier');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(tokenEndpoint, 'tokenEndpoint');

  const body = new URLSearchParams({
    client_key: key,
    client_secret: secret,
    code: authCode,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code_verifier: verifier
  }).toString();

  let response;
  try {
    response = await transport(tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-store'
      },
      body
    });
  } catch (err) {
    throw new TikTokOAuthError('network error during TikTok token exchange', {
      code: 'TRANSPORT_FAILURE',
      providerCode: err?.code ?? null
    });
  }

  const status = Number(response?.status ?? 0);
  let payload = null;
  try {
    payload = typeof response.json === 'function' ? await response.json() : JSON.parse(response.text || '{}');
  } catch {
    payload = null;
  }

  if (status < 200 || status >= 300) {
    const providerMsg = payload?.error?.message || payload?.message || `HTTP ${status}`;
    const providerCode = payload?.error?.code || payload?.code || String(status);
    throw new TikTokOAuthError(`token exchange failed: ${providerMsg}`, {
      code: 'TIKTOK_EXCHANGE_FAILED',
      providerCode,
      httpStatus: status
    });
  }

  return normalizeTikTokTokenPayload(payload, clock);
}

export async function refreshTikTokToken({
  clientKey,
  clientSecret,
  refreshToken,
  tokenEndpoint = TIKTOK_TOKEN_ENDPOINT,
  transport = fetch,
  clock = Date.now
}) {
  const key = requiredString(clientKey, 'clientKey');
  const secret = requiredString(clientSecret, 'clientSecret');
  const refresh = requiredString(refreshToken, 'refreshToken');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(tokenEndpoint, 'tokenEndpoint');

  const body = new URLSearchParams({
    client_key: key,
    client_secret: secret,
    grant_type: 'refresh_token',
    refresh_token: refresh
  }).toString();

  let response;
  try {
    response = await transport(tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-store'
      },
      body
    });
  } catch (err) {
    throw new TikTokOAuthError('network error during TikTok token refresh', {
      code: 'TRANSPORT_FAILURE',
      providerCode: err?.code ?? null
    });
  }

  const status = Number(response?.status ?? 0);
  let payload = null;
  try {
    payload = typeof response.json === 'function' ? await response.json() : JSON.parse(response.text || '{}');
  } catch {
    payload = null;
  }

  if (status < 200 || status >= 300) {
    const providerCode = String(payload?.error?.code || payload?.code || status);
    const isRevoked = status === 400 || status === 401 || providerCode === 'invalid_grant' || providerCode === 'token_invalid';
    throw new TikTokOAuthError(`token refresh failed (${providerCode})`, {
      code: isRevoked ? 'REAUTH_REQUIRED' : 'TIKTOK_REFRESH_FAILED',
      providerCode,
      httpStatus: status
    });
  }

  return normalizeTikTokTokenPayload(payload, clock);
}

export async function revokeTikTokToken({
  clientKey,
  clientSecret,
  token,
  revokeEndpoint = TIKTOK_REVOKE_ENDPOINT,
  transport = fetch
}) {
  const key = requiredString(clientKey, 'clientKey');
  const secret = requiredString(clientSecret, 'clientSecret');
  const targetToken = requiredString(token, 'token');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(revokeEndpoint, 'revokeEndpoint');

  const body = new URLSearchParams({
    client_key: key,
    client_secret: secret,
    token: targetToken
  }).toString();

  try {
    const res = await transport(revokeEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    return Object.freeze({ revoked: true, status: res.status });
  } catch (err) {
    // Revocation failure should not crash disconnect logic
    return Object.freeze({ revoked: false, error: String(err?.message ?? err) });
  }
}

export async function fetchTikTokUserInfo({
  accessToken,
  userInfoEndpoint = TIKTOK_USER_INFO_ENDPOINT,
  transport = fetch
}) {
  const token = requiredString(accessToken, 'accessToken');
  if (typeof transport !== 'function') throw new TypeError('transport must be a function');

  const validator = createUrlValidator({ allowedSchemes: ['https'], blockPrivateRanges: true });
  validator.validate(userInfoEndpoint, 'userInfoEndpoint');

  const url = new URL(userInfoEndpoint);
  url.searchParams.set('fields', 'open_id,union_id,avatar_url,display_name,username');

  let response;
  try {
    response = await transport(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    throw new TikTokOAuthError('network error during TikTok user info query', {
      code: 'TRANSPORT_FAILURE',
      providerCode: err?.code ?? null
    });
  }

  const status = Number(response?.status ?? 0);
  let payload = null;
  try {
    payload = typeof response.json === 'function' ? await response.json() : JSON.parse(response.text || '{}');
  } catch {
    payload = null;
  }

  if (status < 200 || status >= 300) {
    throw new TikTokOAuthError(`user info query failed (HTTP ${status})`, {
      code: 'USER_INFO_FAILED',
      httpStatus: status
    });
  }

  const err = payload?.error;
  if (err && err.code && err.code !== 'ok' && err.code !== '0') {
    throw new TikTokOAuthError(String(err.message || 'TikTok user info rejected'), {
      code: 'TIKTOK_PROVIDER_ERROR',
      providerCode: String(err.code)
    });
  }

  const user = payload?.data?.user || {};
  return Object.freeze({
    openId: user.open_id ? String(user.open_id) : null,
    unionId: user.union_id ? String(user.union_id) : null,
    avatarUrl: user.avatar_url ? String(user.avatar_url) : null,
    displayName: user.display_name ? String(user.display_name) : null,
    username: user.username ? String(user.username) : null
  });
}
