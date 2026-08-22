const DEFAULT_AUTH_HOST = 'https://auth.tiktok-shops.com';

function requireValue(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function buildTikTokAuthorizationUrl({ appKey, state, authHost = DEFAULT_AUTH_HOST }) {
  const key = requireValue(appKey, 'appKey');
  const csrfState = requireValue(state, 'state');
  const url = new URL('/oauth/authorize', authHost);
  url.searchParams.set('app_key', key);
  url.searchParams.set('state', csrfState);
  return url.toString();
}

export function buildAuthorizationCodeExchange({ appKey, appSecret, authCode, authHost = DEFAULT_AUTH_HOST }) {
  const url = new URL('/api/v2/token/get', authHost);
  url.searchParams.set('app_key', requireValue(appKey, 'appKey'));
  url.searchParams.set('app_secret', requireValue(appSecret, 'appSecret'));
  url.searchParams.set('auth_code', requireValue(authCode, 'authCode'));
  url.searchParams.set('grant_type', 'authorized_code');
  return Object.freeze({ method: 'GET', url: url.toString() });
}

export function buildRefreshTokenRequest({ appKey, appSecret, refreshToken, authHost = DEFAULT_AUTH_HOST }) {
  const url = new URL('/api/v2/token/refresh', authHost);
  url.searchParams.set('app_key', requireValue(appKey, 'appKey'));
  url.searchParams.set('app_secret', requireValue(appSecret, 'appSecret'));
  url.searchParams.set('refresh_token', requireValue(refreshToken, 'refreshToken'));
  url.searchParams.set('grant_type', 'refresh_token');
  return Object.freeze({ method: 'GET', url: url.toString() });
}

export function normalizeTokenResponse(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('token response is required');
  if (Number(payload.code) !== 0) {
    const error = new Error(String(payload.message || 'TikTok authorization failed'));
    error.code = 'TIKTOK_AUTH_ERROR';
    error.providerCode = payload.code;
    throw error;
  }
  const data = payload.data || {};
  const accessToken = requireValue(data.access_token, 'access_token');
  const refreshToken = requireValue(data.refresh_token, 'refresh_token');
  return Object.freeze({
    accessToken,
    refreshToken,
    accessTokenExpiresIn: Number(data.access_token_expire_in ?? data.access_token_expires_in ?? 0),
    refreshTokenExpiresIn: Number(data.refresh_token_expire_in ?? data.refresh_token_expires_in ?? 0),
    openId: data.open_id == null ? null : String(data.open_id),
    sellerName: data.seller_name == null ? null : String(data.seller_name)
  });
}
