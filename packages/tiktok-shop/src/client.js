import { signTikTokRequest } from './signing.js';

export const TikTokResources = Object.freeze([
  'authorization','seller','product','global_product','order','fulfillment','logistic','finance','promotion','supplychain','event','return_refund','customer_service','affiliate_seller','affiliate_creator','affiliate_partner','analytics','fulfilled_by_tiktok'
]);

export function normalizeTikTokProviderError({ status, payload, requestId = null }) {
  const providerCode = payload && typeof payload === 'object' ? payload.code ?? payload.error_code ?? null : null;
  const message = payload && typeof payload === 'object' ? payload.message ?? payload.error_message ?? `TikTok request failed (${status})` : `TikTok request failed (${status})`;
  const error = new Error(String(message));
  error.name = 'TikTokProviderError';
  error.code = 'TIKTOK_PROVIDER_ERROR';
  error.httpStatus = Number(status || 0);
  error.providerCode = providerCode;
  error.requestId = requestId;
  error.retryable = error.httpStatus === 429 || error.httpStatus >= 500;
  return error;
}

export function computeRetryDelayMs({ attempt, baseMs = 250, maxMs = 10_000 }) {
  const n = Math.max(0, Number(attempt || 0));
  return Math.min(maxMs, baseMs * (2 ** n));
}

export function normalizePagination(input = {}) {
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 20)));
  const pageToken = input.pageToken == null ? null : String(input.pageToken);
  return Object.freeze({ pageSize, pageToken });
}

export function buildTikTokRequest({ baseUrl = 'https://open-api.tiktokglobalshop.com', path, method = 'GET', query = {}, body = null, appKey, appSecret, accessToken = null, shopCipher = null, timestamp = Math.floor(Date.now() / 1000) }) {
  if (!appKey || !appSecret) throw new Error('appKey and appSecret are required');
  const url = new URL(path, baseUrl);
  const finalQuery = { ...query, app_key: appKey, timestamp };
  if (shopCipher) finalQuery.shop_cipher = shopCipher;
  const serializedBody = body == null ? '' : JSON.stringify(body);
  const sign = signTikTokRequest({ path: url.pathname, query: finalQuery, body: serializedBody, method, contentType: 'application/json', appSecret });
  for (const [key, value] of Object.entries({ ...finalQuery, sign })) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const headers = { 'content-type': 'application/json' };
  if (accessToken) headers['x-tts-access-token'] = accessToken;
  return Object.freeze({ method: String(method).toUpperCase(), url: url.toString(), headers: Object.freeze(headers), body: serializedBody || null });
}

export function assertResourceSupported(resource) {
  const normalized = String(resource || '').trim().toLowerCase();
  if (!TikTokResources.includes(normalized)) throw new Error(`unsupported TikTok resource: ${normalized || '<empty>'}`);
  return normalized;
}
