import { createHmac, timingSafeEqual } from 'node:crypto';

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const LazadaEndpoints = Object.freeze({
  generateAccessToken: '/auth/token/create',
  refreshAccessToken: '/auth/token/refresh',
  products: '/products/get',
  orders: '/orders/get',
  orderItems: '/order/items/get',
  seller: '/seller/get',
  affiliateLink: '/affiliate/link/generate'
});

export function buildLazadaSign({ appSecret, params }) {
  const secret = requiredString(appSecret, 'appSecret');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object');
  const canonical = Object.entries(params)
    .filter(([key]) => key !== 'sign')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${String(value ?? '')}`)
    .join('');
  return createHmac('sha256', secret).update(canonical).digest('hex').toUpperCase();
}

export function timingSafeHexEqual(expectedHex, actualHex) {
  const a = Buffer.from(String(expectedHex ?? ''), 'hex');
  const b = Buffer.from(String(actualHex ?? ''), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyLazadaSign({ appSecret, params, signature }) {
  const expected = buildLazadaSign({ appSecret, params });
  return timingSafeHexEqual(expected, requiredString(signature, 'signature'));
}

function stringifyParams(params) {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) throw new Error('params must be an object');
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    out[requiredString(key, 'param name')] = String(value);
  }
  return out;
}

function requireIsoDate(value, name) {
  const raw = requiredString(value, name);
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an ISO-8601 timestamp`);
  return new Date(parsed).toISOString();
}

function lazadaProviderError(status, payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const error = new Error(String(safe.message ?? `lazada request failed (${status})`));
  error.name = 'LazadaProviderError';
  error.code = 'LAZADA_PROVIDER_ERROR';
  error.httpStatus = Number(status || 0);
  error.providerCode = safe.code == null ? null : String(safe.code);
  const providerCode = String(safe.code ?? '');
  error.retryable = Number(status) === 429 || Number(status) >= 500 || providerCode === '7' || providerCode === '8';
  return error;
}

export function createLazadaClient({ baseUrl = 'https://api.lazada.com/rest', appKey, appSecret, transport } = {}) {
  const host = requiredString(baseUrl, 'baseUrl').replace(/\/+$/, '');
  const key = requiredString(appKey, 'appKey');
  const secret = requiredString(appSecret, 'appSecret');
  if (typeof transport !== 'function') throw new Error('transport function is required');

  async function call(apiPath, { params = {}, accessToken = null } = {}) {
    const pathname = requiredString(apiPath, 'apiPath');
    if (!pathname.startsWith('/')) throw new Error('apiPath must start with /');
    const timestamp = Date.now();
    const all = { app_key: key, sign_method: 'hmac-sha256', timestamp, ...stringifyParams(params) };
    if (accessToken != null) all.access_token = requiredString(accessToken, 'accessToken');
    const sign = buildLazadaSign({ appSecret: secret, params: all });
    const url = new URL(`${host}${pathname}`);
    for (const [paramKey, value] of Object.entries(all)) url.searchParams.set(paramKey, String(value));
    url.searchParams.set('sign', sign);
    const request = Object.freeze({
      platform: 'lazada',
      method: 'GET',
      path: pathname,
      timestamp,
      url: url.toString(),
      headers: Object.freeze({ accept: 'application/json' }),
      body: null
    });
    const response = await transport(request);
    const status = Number(response?.status ?? 0);
    if (status < 200 || status >= 300) throw lazadaProviderError(status, response?.payload);
    const payload = response?.payload;
    const frozenPayload = Object.freeze(payload && typeof payload === 'object' ? { ...payload } : { value: payload });
    const providerCode = payload && typeof payload === 'object' ? payload.code ?? null : null;
    if (providerCode != null && String(providerCode) !== '0') throw lazadaProviderError(status, frozenPayload);
    return Object.freeze({ request, status, payload: frozenPayload });
  }

  async function generateAccessToken(code) {
    return call(LazadaEndpoints.generateAccessToken, { params: { code: requiredString(code, 'code') } });
  }

  async function refreshAccessToken(refreshTokenValue) {
    return call(LazadaEndpoints.refreshAccessToken, { params: { refresh_token: requiredString(refreshTokenValue, 'refreshToken') } });
  }

  async function getProducts({ offset = 0, limit = 20, filter = null, accessToken = null } = {}) {
    const offsetNumber = Number(offset);
    if (!Number.isInteger(offsetNumber) || offsetNumber < 0) throw new Error('offset must be a non-negative integer');
    const limitNumber = Math.min(100, Math.max(1, Number(limit)));
    if (!Number.isInteger(limitNumber)) throw new Error('limit must be an integer');
    return call(LazadaEndpoints.products, { params: { offset: offsetNumber, limit: limitNumber, filter }, accessToken });
  }

  async function getOrders({ createdAfter, createdBefore, status = null, offset = 0, limit = 20, accessToken = null } = {}) {
    return call(LazadaEndpoints.orders, {
      params: {
        created_after: requireIsoDate(createdAfter, 'createdAfter'),
        created_before: requireIsoDate(createdBefore, 'createdBefore'),
        status,
        offset,
        limit
      },
      accessToken
    });
  }

  async function getOrderItems(orderId, { accessToken = null } = {}) {
    return call(LazadaEndpoints.orderItems, { params: { order_id: requiredString(orderId, 'orderId') }, accessToken });
  }

  async function sellerGet({ accessToken = null } = {}) {
    return call(LazadaEndpoints.seller, { accessToken });
  }

  async function generateAffiliateLink({ idempotencyKey, originalUrl, linkName = null } = {}) {
    requiredString(idempotencyKey, 'idempotencyKey');
    const url = requiredString(originalUrl, 'originalUrl');
    if (!/^https?:\/\//i.test(url)) throw new Error('originalUrl must be an http(s) URL');
    return call(LazadaEndpoints.affiliateLink, {
      params: {
        original_url: url,
        idempotency_key: requiredString(idempotencyKey, 'idempotencyKey'),
        link_name: linkName
      }
    });
  }

  return Object.freeze({
    platform: 'lazada',
    baseUrl: host,
    endpoints: LazadaEndpoints,
    generateAccessToken,
    refreshAccessToken,
    getProducts,
    getOrders,
    getOrderItems,
    sellerGet,
    generateAffiliateLink
  });
}
