import test from 'node:test';
import assert from 'node:assert/strict';
import { TikTokResources, normalizeTikTokProviderError, computeRetryDelayMs, normalizePagination, buildTikTokRequest, assertResourceSupported } from '../packages/tiktok-shop/src/client.js';

test('resource registry covers affiliate and commerce surfaces', () => {
  for (const resource of ['affiliate_creator','affiliate_partner','affiliate_seller','product','order','finance','fulfillment','analytics']) {
    assert.equal(assertResourceSupported(resource), resource);
  }
  assert.ok(TikTokResources.length >= 18);
  assert.throws(() => assertResourceSupported('unknown'), /unsupported TikTok resource/);
});

test('provider errors normalize retryability', () => {
  const rateLimit = normalizeTikTokProviderError({ status: 429, payload: { code: 12001, message: 'slow down' }, requestId: 'req-1' });
  assert.equal(rateLimit.retryable, true);
  assert.equal(rateLimit.providerCode, 12001);
  assert.equal(rateLimit.requestId, 'req-1');
  const badRequest = normalizeTikTokProviderError({ status: 400, payload: { message: 'bad input' } });
  assert.equal(badRequest.retryable, false);
});

test('retry delay is bounded exponential backoff', () => {
  assert.equal(computeRetryDelayMs({ attempt: 0 }), 250);
  assert.equal(computeRetryDelayMs({ attempt: 3 }), 2000);
  assert.equal(computeRetryDelayMs({ attempt: 99 }), 10000);
});

test('pagination normalizes page sizes and tokens', () => {
  assert.deepEqual(normalizePagination({ pageSize: 500, pageToken: 123 }), { pageSize: 100, pageToken: '123' });
  assert.deepEqual(normalizePagination({ pageSize: 0 }), { pageSize: 20, pageToken: null });
});

test('request builder signs server-side and keeps token in headers', () => {
  const request = buildTikTokRequest({
    path: '/order/202309/orders/search',
    method: 'POST',
    query: { page_size: 20 },
    body: { order_status: 'UNPAID' },
    appKey: 'app',
    appSecret: 'secret',
    accessToken: 'access',
    shopCipher: 'cipher',
    timestamp: 1700000000
  });
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('app_key'), 'app');
  assert.equal(url.searchParams.get('timestamp'), '1700000000');
  assert.equal(url.searchParams.get('shop_cipher'), 'cipher');
  assert.match(url.searchParams.get('sign'), /^[a-f0-9]{64}$/);
  assert.equal(url.searchParams.has('x-tts-access-token'), false);
  assert.equal(request.headers['x-tts-access-token'], 'access');
});
