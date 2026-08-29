import { createHmac, timingSafeEqual } from 'node:crypto';

function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function positiveInteger(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function unixSecondsNow() {
  return Math.floor(Date.now() / 1000);
}

export const ShopeeEndpoints = Object.freeze({
  authPartner: '/api/v2/shop/auth_partner/get',
  tokenGet: '/api/v2/auth/token/get',
  tokenRefresh: '/api/v2/auth/access_token/get',
  searchItems: '/api/v2/product/search_items',
  itemList: '/api/v2/product/get_item_list',
  orderList: '/api/v2/order/get_order_list',
  affiliateLink: '/api/v2/first_open_platform/generate_affiliate_link'
});

export const ShopeeOrderStatuses = Object.freeze(['UNPAID', 'READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED', 'IN_CANCEL', 'CANCELLED', 'ALL']);

export function buildShopeeSignature({ partnerKey, partnerId, path, timestamp, body = null }) {
  const secret = requiredString(partnerKey, 'partnerKey');
  const pathname = requiredString(path, 'path');
  if (!pathname.startsWith('/')) throw new Error('path must start with /');
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || seconds <= 0) throw new Error('timestamp must be unix seconds');
  const id = requiredString(partnerId, 'partnerId');
  const serialized = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return createHmac('sha256', secret).update(`${pathname}${seconds}${id}${serialized}`).digest('hex');
}

export function timingSafeHexEqual(expectedHex, actualHex) {
  const a = Buffer.from(String(expectedHex ?? ''), 'hex');
  const b = Buffer.from(String(actualHex ?? ''), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function verifyShopeeSignature({ partnerKey, partnerId, path, timestamp, body = null, signature }) {
  const expected = buildShopeeSignature({ partnerKey, partnerId, path, timestamp, body });
  return timingSafeHexEqual(expected, requiredString(signature, 'signature'));
}

function shopeeProviderError(status, payload) {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const error = new Error(String(safe.message ?? safe.error_message ?? `shopee request failed (${status})`));
  error.name = 'ShopeeProviderError';
  error.code = 'SHOPEE_PROVIDER_ERROR';
  error.httpStatus = Number(status || 0);
  error.providerCode = safe.error == null ? null : String(safe.error);
  return error;
}

export function createShopeeClient({ baseUrl = 'https://partner.shopeemobile.com', partnerId, partnerKey, transport } = {}) {
  const host = requiredString(baseUrl, 'baseUrl').replace(/\/+$/, '');
  const id = requiredString(partnerId, 'partnerId');
  const secret = requiredString(partnerKey, 'partnerKey');
  if (typeof transport !== 'function') throw new Error('transport function is required');

  function buildUrl(path, { params = {}, timestamp, sign }) {
    const url = new URL(`${host}${path}`);
    url.searchParams.set('partner_id', id);
    url.searchParams.set('timestamp', String(timestamp));
    url.searchParams.set('sign', sign);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
    return url;
  }

  async function call(path, { method = 'GET', params = {}, body = null } = {}) {
    const pathname = requiredString(path, 'path');
    if (!pathname.startsWith('/')) throw new Error('path must start with /');
    const upperMethod = String(method).toUpperCase();
    const timestamp = unixSecondsNow();
    const serializedBody = upperMethod === 'GET' || body == null ? '' : JSON.stringify(body);
    const sign = buildShopeeSignature({ partnerKey: secret, partnerId: id, path: pathname, timestamp, body: serializedBody });
    const url = buildUrl(pathname, { params, timestamp, sign });
    const request = Object.freeze({
      platform: 'shopee',
      method: upperMethod,
      path: pathname,
      timestamp,
      url: url.toString(),
      headers: Object.freeze({ 'content-type': 'application/json' }),
      body: serializedBody || null
    });
    const response = await transport(request);
    const status = Number(response?.status ?? 0);
    if (status < 200 || status >= 300) throw shopeeProviderError(status, response?.payload);
    const payload = response?.payload;
    return Object.freeze({
      request,
      status,
      payload: Object.freeze(payload && typeof payload === 'object' ? { ...payload } : { value: payload })
    });
  }

  function getAuthUrl({ redirectUrl } = {}) {
    const redirect = requiredString(redirectUrl, 'redirectUrl');
    const timestamp = unixSecondsNow();
    const sign = buildShopeeSignature({ partnerKey: secret, partnerId: id, path: ShopeeEndpoints.authPartner, timestamp, body: null });
    const url = buildUrl(ShopeeEndpoints.authPartner, { params: { redirect }, timestamp, sign });
    return Object.freeze({ url: url.toString(), path: ShopeeEndpoints.authPartner, timestamp, sign });
  }

  function getToken(shopId, code) {
    return call(ShopeeEndpoints.tokenGet, {
      method: 'POST',
      body: { shop_id: positiveInteger(shopId, 'shopId'), code: requiredString(code, 'code') }
    });
  }

  function refreshToken(refreshTokenValue, shopId = null) {
    const body = { refresh_token: requiredString(refreshTokenValue, 'refreshToken') };
    if (shopId != null) body.shop_id = positiveInteger(shopId, 'shopId');
    return call(ShopeeEndpoints.tokenRefresh, { method: 'POST', body });
  }

  async function searchItems({ keyword, categoryId = null, pageNumber = 1, pageSize = 20 } = {}) {
    return call(ShopeeEndpoints.searchItems, {
      params: {
        keyword: requiredString(keyword, 'keyword'),
        category_id: categoryId,
        page_number: positiveInteger(pageNumber, 'pageNumber'),
        page_size: Math.min(100, positiveInteger(pageSize, 'pageSize'))
      }
    });
  }

  async function getItemList({ categoryId = null, offsetItemId = null, pageSize = 20 } = {}) {
    return call(ShopeeEndpoints.itemList, {
      params: {
        category_id: categoryId,
        offset_item_id: offsetItemId,
        page_size: Math.min(100, positiveInteger(pageSize, 'pageSize'))
      }
    });
  }

  async function getOrderList({ timeFrom, timeTo, pageSize = 20, cursor = null } = {}) {
    const from = positiveInteger(timeFrom, 'timeFrom');
    const to = positiveInteger(timeTo, 'timeTo');
    if (to < from) throw new Error('timeTo must not be before timeFrom');
    if (to - from > 15 * 24 * 60 * 60) throw new Error('time range exceeds 15 days');
    return call(ShopeeEndpoints.orderList, {
      params: { time_from: from, time_to: to, page_size: Math.min(100, positiveInteger(pageSize, 'pageSize')), cursor }
    });
  }

  async function getOrderByStatus(orderStatus, { pageSize = 20, cursor = null } = {}) {
    const status = requiredString(orderStatus, 'orderStatus');
    if (!ShopeeOrderStatuses.includes(status)) throw new Error(`unsupported order status: ${status}`);
    return call(ShopeeEndpoints.orderList, {
      params: { order_status: status, page_size: Math.min(100, positiveInteger(pageSize, 'pageSize')), cursor }
    });
  }

  async function generateAffiliateLink({ idempotencyKey, siteId, originalUrl } = {}) {
    requiredString(idempotencyKey, 'idempotencyKey');
    const url = requiredString(originalUrl, 'originalUrl');
    if (!/^https:\/\//i.test(url)) throw new Error('originalUrl must be an https URL');
    return call(ShopeeEndpoints.affiliateLink, {
      method: 'POST',
      body: {
        idempotency_key: requiredString(idempotencyKey, 'idempotencyKey'),
        site_id: requiredString(siteId, 'siteId'),
        original_url: url
      }
    });
  }

  return Object.freeze({
    platform: 'shopee',
    baseUrl: host,
    partnerId: id,
    endpoints: ShopeeEndpoints,
    orderStatuses: ShopeeOrderStatuses,
    getAuthUrl,
    getToken,
    refreshToken,
    searchItems,
    getItemList,
    getOrderList,
    getOrderByStatus,
    generateAffiliateLink
  });
}
