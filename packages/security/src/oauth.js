import { createHash, randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

export class OAuthStateError extends Error {
  constructor(reason) {
    super(`oauth state rejected (${reason})`);
    this.name = 'OAuthStateError';
    this.reason = reason;
    this.code = 'OAUTH_STATE_REJECTED';
  }
}

export class OAuthTokenError extends Error {
  constructor(reason, httpStatus = null) {
    super(`oauth token exchange failed (${reason})`);
    this.name = 'OAuthTokenError';
    this.reason = reason;
    this.httpStatus = httpStatus;
    this.code = 'OAUTH_TOKEN_FAILED';
  }
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function httpsUrl(value, label) {
  const text = requireText(value, label);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must be https`);
  return parsed.toString();
}

function base64url(buffer) {
  return buffer.toString('base64url');
}

export function createOAuthFlow({
  provider,
  clientId,
  clientSecret,
  authorizeUrl,
  tokenUrl,
  redirectUri,
  scope,
  transport,
  useNonce = false,
  clock = () => Date.now(),
  randomBytesFn = randomBytes
} = {}) {
  const normalizedProvider = requireText(provider, 'provider').toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(normalizedProvider)) throw new Error('provider must be 2-32 chars of a-z0-9_-');
  const id = requireText(clientId, 'clientId');
  const secret = requireText(clientSecret, 'clientSecret');
  const authUrl = httpsUrl(authorizeUrl, 'authorizeUrl');
  const tokenEndpoint = httpsUrl(tokenUrl, 'tokenUrl');
  const callback = httpsUrl(redirectUri, 'redirectUri');
  if (typeof transport !== 'function') throw new TypeError('transport function is required');
  if (typeof useNonce !== 'boolean') throw new TypeError('useNonce must be a boolean');

  async function postForm(form) {
    const body = new URLSearchParams(form).toString();
    let response;
    try {
      response = await transport({ url: tokenEndpoint, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    } catch (error) {
      if (error instanceof OAuthTokenError) throw error;
      throw new OAuthTokenError('transport_failure', null);
    }
    const status = Number(response?.status ?? 0);
    let json = response?.json;
    if (json == null && typeof response?.text === 'string') {
      try {
        json = JSON.parse(response.text);
      } catch {
        json = null;
      }
    }
    if (status < 200 || status >= 300) {
      throw new OAuthTokenError(String(json?.error ?? `http_${status}`), status);
    }
    return json;
  }

  function createAuthorization({ stateTtlMs = STATE_TTL_MS } = {}) {
    const ttl = Number(stateTtlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('stateTtlMs must be a positive number');
    const state = base64url(randomBytesFn(24));
    const codeVerifier = base64url(randomBytesFn(48));
    const nonce = useNonce ? base64url(randomBytesFn(24)) : null;
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const now = clock();
    const url = new URL(authUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', id);
    url.searchParams.set('redirect_uri', callback);
    if (scope) url.searchParams.set('scope', String(scope));
    url.searchParams.set('state', state);
    if (nonce) url.searchParams.set('nonce', nonce);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return Object.freeze({
      provider: normalizedProvider,
      url: url.toString(),
      state,
      codeVerifier,
      nonce,
      createdAt: now,
      expiresAt: now + ttl
    });
  }

  function assertStateUsable(authorization) {
    if (!authorization || typeof authorization !== 'object') throw new OAuthStateError('missing_authorization');
    if (typeof authorization.state !== 'string' || !authorization.state) throw new OAuthStateError('missing_pending_state');
    if (Number.isFinite(authorization.expiresAt) && clock() > authorization.expiresAt) throw new OAuthStateError('state_expired');
  }

  async function exchangeCode({ authorization, code }) {
    assertStateUsable(authorization);
    const grant = requireText(code, 'code');
    const payload = {
      grant_type: 'authorization_code',
      code: grant,
      redirect_uri: callback,
      client_id: id,
      client_secret: secret,
      code_verifier: authorization.codeVerifier
    };
    if (!authorization.codeVerifier || typeof authorization.codeVerifier !== 'string') throw new OAuthStateError('missing_code_verifier');
    const json = await postForm(payload);
    const accessToken = json?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) throw new OAuthTokenError('missing_access_token', 200);
    const expiresIn = Number(json?.expires_in);
    const tokens = {
      accessToken,
      refreshToken: typeof json?.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
      idToken: typeof json?.id_token === 'string' && json.id_token ? json.id_token : null,
      tokenType: typeof json?.token_type === 'string' ? json.token_type : 'Bearer',
      scope: typeof json?.scope === 'string' ? json.scope : null,
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? clock() + expiresIn * 1000 : null,
      providerAccountId: firstText(
        json?.provider_account_id,
        json?.account_id,
        json?.open_id,
        json?.user_id,
        json?.sub
      )
    };
    return Object.freeze(tokens);
  }

  function refreshRequest(refreshToken) {
    const token = requireText(refreshToken, 'refreshToken');
    return Object.freeze({
      url: tokenEndpoint,
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: id,
        client_secret: secret
      }).toString()
    });
  }

  return Object.freeze({
    provider: normalizedProvider,
    createAuthorization,
    exchangeCode,
    refreshRequest,
    tokenUrl: tokenEndpoint
  });
}

const EMPTY_SECRET = '__zaff_revoked__';

export function createTokenStore({ manager, provider, flow, clock = () => Date.now() } = {}) {
  if (!manager || typeof manager.put !== 'function' || typeof manager.resolve !== 'function') {
    throw new TypeError('secret manager with resolve/put is required');
  }
  const normalizedProvider = requireText(provider, 'provider').toLowerCase();
  if (!flow || typeof flow.refreshRequest !== 'function' || typeof flow.tokenUrl !== 'string') {
    throw new TypeError('flow with refreshRequest and tokenUrl is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const refreshRef = `ref:oauth/${normalizedProvider}/refresh`;
  const accessRef = `ref:oauth/${normalizedProvider}/access`;

  function peek(ref) {
    try {
      const value = manager.resolve(ref).value;
      return typeof value === 'string' && value.length > 0 && value !== EMPTY_SECRET ? value : null;
    } catch {
      return null;
    }
  }

  function store(tokens) {
    if (!tokens || typeof tokens.accessToken !== 'string' || !tokens.accessToken) throw new Error('tokens.accessToken is required');
    manager.put(accessRef, tokens.accessToken);
    manager.put(refreshRef, tokens.refreshToken ?? EMPTY_SECRET);
    return Object.freeze({ stored: true });
  }

  function clear() {
    manager.put(accessRef, EMPTY_SECRET);
    manager.put(refreshRef, EMPTY_SECRET);
  }

  function storedRefreshToken() {
    return peek(refreshRef);
  }

  function readAccessToken() {
    return peek(accessRef);
  }

  async function refresh({ transport } = {}) {
    if (typeof transport !== 'function') throw new TypeError('transport function is required');
    const refreshToken = storedRefreshToken();
    if (!refreshToken) return Object.freeze({ status: 'REAUTH_REQUIRED', reason: 'no_refresh_token' });
    const request = flow.refreshRequest(refreshToken);
    let json;
    let failedStatus = null;
    let failureReason = null;
    try {
      const response = await transport({
        url: request.url,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: request.body
      });
      const status = Number(response?.status ?? 0);
      json = response?.json;
      if (status < 200 || status >= 300) {
        failedStatus = status;
        failureReason = String(json?.error ?? `http_${status}`);
      }
    } catch {
      failedStatus = 0;
      failureReason = 'transport_failure';
    }
    if (failedStatus !== null) {
      clear();
      const revoked = failedStatus === 400 || failedStatus === 401 || failureReason === 'invalid_grant';
      if (!revoked) return Object.freeze({ status: 'REFRESH_FAILED', reason: failureReason, httpStatus: failedStatus });
      return Object.freeze({ status: 'REAUTH_REQUIRED', reason: failureReason || 'revoked' });
    }
    const accessToken = json?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      clear();
      return Object.freeze({ status: 'REAUTH_REQUIRED', reason: 'missing_access_token' });
    }
    const rotated = typeof json?.refresh_token === 'string' && json.refresh_token ? json.refresh_token : refreshToken;
    store({ accessToken, refreshToken: rotated, expiresAt: null });
    const expiresIn = Number(json?.expires_in);
    return Object.freeze({
      status: 'REFRESHED',
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? clock() + expiresIn * 1000 : null
    });
  }

  return Object.freeze({ provider: normalizedProvider, store, clear, refresh, readAccessToken, storedRefreshToken, refreshRef, accessRef });
}
