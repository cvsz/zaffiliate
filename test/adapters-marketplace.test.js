import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createShopeeClient, buildShopeeSignature, timingSafeHexEqual, verifyShopeeSignature, ShopeeEndpoints, ShopeeOrderStatuses } from '../packages/adapters/src/shopee.js';
import { createLazadaClient, buildLazadaSign, verifyLazadaSign } from '../packages/adapters/src/lazada.js';
import { createPublishingAdapter } from '../packages/adapters/src/publishing.js';
import { createLineAdapter, verifyLineWebhookSignature } from '../packages/adapters/src/line.js';
import { createRateLimitPolicy, normalizeProviderError, ProviderErrorCodePolicy } from '../packages/adapters/src/rate-limit.js';

test('shopee signing is deterministic over path+timestamp+partnerId+body and rejects tampering', () => {
  const base = { partnerKey: 'pk-secret', partnerId: '1006822', path: '/api/v2/auth/token/get', timestamp: 1720000000, body: '{"shop_id":123}' };
  const signature = buildShopeeSignature(base);
  assert.equal(signature, buildShopeeSignature({ ...base }));
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.notEqual(signature, buildShopeeSignature({ ...base, body: '{"shop_id":456}' }));
  assert.notEqual(signature, buildShopeeSignature({ ...base, path: '/api/v2/auth/token/set' }));
  assert.notEqual(signature, buildShopeeSignature({ ...base, timestamp: 1720000001 }));
  assert.notEqual(signature, buildShopeeSignature({ ...base, partnerId: '1006823' }));
  assert.equal(timingSafeHexEqual(signature, signature), true);
  assert.equal(timingSafeHexEqual(signature, 'f'.repeat(64)), false);
  assert.equal(verifyShopeeSignature({ ...base, signature }), true);
  assert.equal(verifyShopeeSignature({ ...base, signature: '0'.repeat(63) + '1' }), false);
  assert.throws(() => buildShopeeSignature({ ...base, timestamp: 1720000000.5 }), /unix seconds/);
  assert.throws(() => buildShopeeSignature({ ...base, path: 'api/v2' }), /must start with \//);
  assert.equal(ShopeeOrderStatuses.includes('ALL'), true);
  assert.ok(Object.isFrozen(ShopeeOrderStatuses));
  assert.ok(Object.isFrozen(ShopeeEndpoints));
  assert.ok(ShopeeEndpoints.tokenGet.startsWith('/'));
});

test('shopee client signs every request with unix-second timestamps and gates affiliate links', async () => {
  const seen = [];
  const transport = async (request) => {
    seen.push(request);
    return { status: 200, payload: { ok: true } };
  };
  const client = createShopeeClient({ partnerId: '1006822', partnerKey: 'pk-secret', transport });

  const auth = client.getAuthUrl({ redirectUrl: 'https://app.example/callback' });
  const authUrl = new URL(auth.url);
  assert.equal(authUrl.searchParams.get('partner_id'), '1006822');
  assert.ok(Number.isInteger(Number(authUrl.searchParams.get('timestamp'))));
  assert.equal(authUrl.searchParams.get('sign'), buildShopeeSignature({ partnerKey: 'pk-secret', partnerId: '1006822', path: auth.path, timestamp: auth.timestamp }));

  await client.getToken(123456, 'auth-code-xyz');
  const tokenRequest = seen.at(-1);
  assert.equal(tokenRequest.method, 'POST');
  assert.deepEqual(JSON.parse(tokenRequest.body), { shop_id: 123456, code: 'auth-code-xyz' });
  const tokenUrl = new URL(tokenRequest.url);
  assert.equal(tokenUrl.searchParams.get('sign'), buildShopeeSignature({ partnerKey: 'pk-secret', partnerId: '1006822', path: tokenRequest.path, timestamp: tokenRequest.timestamp, body: tokenRequest.body }));
  assert.ok(Number.isInteger(tokenRequest.timestamp));
  assert.ok(tokenRequest.timestamp <= Math.floor(Date.now() / 1000) + 5);

  await assert.rejects(() => client.getOrderByStatus('MAGIC'), /unsupported order status/);
  await assert.rejects(() => client.getOrderList({ timeFrom: 1720000000, timeTo: 1720000000 + 16 * 24 * 60 * 60 }), /15 days/);
  await assert.rejects(() => client.generateAffiliateLink({ siteId: 'site-1', originalUrl: 'https://item.example/x' }), /idempotencyKey is required/);

  await client.generateAffiliateLink({ idempotencyKey: 'idem-shopee-1', siteId: 'site-1', originalUrl: 'https://item.example/x' });
  const mutateRequest = seen.at(-1);
  assert.deepEqual(JSON.parse(mutateRequest.body), { idempotency_key: 'idem-shopee-1', site_id: 'site-1', original_url: 'https://item.example/x' });
  const mutateUrl = new URL(mutateRequest.url);
  assert.equal(mutateUrl.searchParams.get('sign'), buildShopeeSignature({ partnerKey: 'pk-secret', partnerId: '1006822', path: mutateRequest.path, timestamp: mutateRequest.timestamp, body: mutateRequest.body }));

  const failing = createShopeeClient({
    partnerId: 'p2',
    partnerKey: 'kk',
    transport: async () => ({ status: 403, payload: { error: 'error_permission', message: 'denied' } })
  });
  await assert.rejects(() => failing.getItemList({}), (error) => error.name === 'ShopeeProviderError' && error.httpStatus === 403 && error.providerCode === 'error_permission');

  assert.throws(() => createShopeeClient({ partnerId: '', partnerKey: 'k', transport }), /partnerId is required/);
  assert.throws(() => createShopeeClient({ partnerId: 'p', partnerKey: 'k' }), /transport function is required/);
});

test('lazada signing concatenates sorted keys with hmac-sha256 and rejects tampering', () => {
  const paramsA = { app_key: 'ak', timestamp: 1720000000000, foo: '1', bar: '2' };
  const paramsB = { bar: '2', timestamp: 1720000000000, foo: '1', app_key: 'ak' };
  const signature = buildLazadaSign({ appSecret: 'ls', params: paramsA });
  assert.equal(signature, buildLazadaSign({ appSecret: 'ls', params: paramsB }));
  assert.match(signature, /^[0-9A-F]{64}$/);
  const expectedCanonical = 'app_keyakbar2foo1timestamp1720000000000';
  assert.equal(signature, createHmac('sha256', 'ls').update(expectedCanonical).digest('hex').toUpperCase());
  assert.notEqual(signature, buildLazadaSign({ appSecret: 'ls', params: { ...paramsA, bar: '3' } }));
  assert.equal(verifyLazadaSign({ appSecret: 'ls', params: paramsA, signature }), true);
  assert.equal(verifyLazadaSign({ appSecret: 'ls', params: { ...paramsA, foo: '9' }, signature }), false);
  assert.throws(() => buildLazadaSign({ appSecret: '', params: paramsA }), /appSecret is required/);
  assert.throws(() => buildLazadaSign({ appSecret: 'ls', params: [1, 2] }), /params must be an object/);
});

test('lazada client signs calls deterministically and requires idempotency for affiliate links', async () => {
  const seen = [];
  const transport = async (request) => {
    seen.push(request);
    return { status: 200, payload: { code: '0', data: { ok: 1 } } };
  };
  const client = createLazadaClient({ appKey: 'ak', appSecret: 'ls', transport });

  await client.generateAccessToken('oauth-code');
  const tokenRequest = seen.at(-1);
  const tokenUrl = new URL(tokenRequest.url);
  const { sign, ...restParams } = Object.fromEntries(tokenUrl.searchParams.entries());
  assert.equal(sign, buildLazadaSign({ appSecret: 'ls', params: restParams }));
  assert.equal(restParams.sign_method, 'hmac-sha256');
  assert.equal(restParams.code, 'oauth-code');
  assert.ok(/^\d+$/.test(restParams.timestamp));

  await client.refreshAccessToken('rt-1');
  const refreshUrl = new URL(seen.at(-1).url);
  assert.equal(refreshUrl.searchParams.get('refresh_token'), 'rt-1');

  await client.getOrderItems('order-9', { accessToken: 'at-1' });
  const itemsUrl = new URL(seen.at(-1).url);
  assert.equal(itemsUrl.searchParams.get('order_id'), 'order-9');
  assert.equal(itemsUrl.searchParams.get('access_token'), 'at-1');

  await assert.rejects(() => client.generateAffiliateLink({ originalUrl: 'https://item.lazada.co.id/p.html' }), /idempotencyKey is required/);
  await client.generateAffiliateLink({ idempotencyKey: 'idem-laz-1', originalUrl: 'https://item.lazada.co.id/p.html' });
  const linkUrl = new URL(seen.at(-1).url);
  assert.equal(linkUrl.searchParams.get('idempotency_key'), 'idem-laz-1');
  const linkParams = Object.fromEntries(linkUrl.searchParams.entries());
  const { sign: linkSign, ...linkRest } = linkParams;
  assert.equal(linkSign, buildLazadaSign({ appSecret: 'ls', params: linkRest }));

  const providerErrorClient = createLazadaClient({
    appKey: 'ak',
    appSecret: 'ls',
    transport: async () => ({ status: 200, payload: { code: '13', message: 'illegal session' } })
  });
  await assert.rejects(() => providerErrorClient.getProducts(), (error) => error.name === 'LazadaProviderError' && error.providerCode === '13' && error.retryable === false);

  assert.throws(() => createLazadaClient({ appKey: '', appSecret: 'ls', transport }), /appKey is required/);
  assert.throws(() => createLazadaClient({ appKey: 'ak', appSecret: 'ls' }), /transport function is required/);
});

test('publishing adapter fails closed on inline secrets, platforms, approval, idempotency and content shape', async () => {
  assert.throws(
    () => createPublishingAdapter({ platform: 'instagram', credentialsRef: 'raw-token-value-0123456789abcd', transport: async () => ({}) }),
    /credential reference/
  );
  assert.throws(
    () => createPublishingAdapter({ platform: 'tiktok', credentialsRef: 'ref:ok', transport: async () => ({}) }),
    /unsupported publishing platform: tiktok/
  );
  assert.throws(
    () => createPublishingAdapter({ platform: 'nope', credentialsRef: 'ref:ok', transport: async () => ({}) }),
    /unsupported publishing platform: nope/
  );
  assert.throws(
    () => createPublishingAdapter({ platform: 'facebook', credentialsRef: 'ref:ok' }),
    /transport function is required/
  );
  const shortRefAdapter = createPublishingAdapter({ platform: 'facebook', credentialsRef: 'short-but-ok', transport: async () => ({ status: 200, payload: { externalId: 'x' } }) });
  assert.equal(shortRefAdapter.platform, 'facebook');

  const seen = [];
  const adapter = createPublishingAdapter({
    platform: 'youtube',
    credentialsRef: 'ref:yt/prod',
    transport: async (request) => {
      seen.push(request);
      return { status: 200, payload: { externalId: 'yt_vid_9' } };
    }
  });

  await assert.rejects(() => adapter.publish({ text: 'hi', mediaUrls: [] }, {}), /approvalRef is required/);
  await assert.rejects(() => adapter.publish({ text: 'hi', mediaUrls: [] }, { approvalRef: 'appr-1' }), /idempotencyKey is required/);
  await assert.rejects(() => adapter.publish(null, { approvalRef: 'a', idempotencyKey: 'i' }), /content must be an object/);
  await assert.rejects(() => adapter.publish({ text: '   ', mediaUrls: [] }, { approvalRef: 'a', idempotencyKey: 'i' }), /non-empty text or at least one media URL/);
  await assert.rejects(() => adapter.publish({ text: 'hi', mediaUrls: ['ftp://x'] }, { approvalRef: 'a', idempotencyKey: 'i' }), /mediaUrls entries must be https URLs/);
  await assert.rejects(() => adapter.publish({ text: 'hi', mediaUrls: [], scheduledAt: 'not-a-date' }, { approvalRef: 'a', idempotencyKey: 'i' }), /scheduledAt must be an ISO-8601 timestamp/);

  const receipt = await adapter.publish(
    { text: 'launch day', mediaUrls: [], scheduledAt: '2026-09-01T10:00:00Z' },
    { approvalRef: 'appr-77', idempotencyKey: 'pub-idem-1' }
  );
  assert.deepEqual(receipt, {
    platform: 'youtube',
    externalId: 'yt_vid_9',
    status: 'queued',
    provenance: { credentialsRef: 'ref:yt/prod', idempotencyKey: 'pub-idem-1' }
  });
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.provenance));

  const request = seen.at(-1);
  assert.equal(request.approvalRef, 'appr-77');
  assert.equal(request.credentialsRef, 'ref:yt/prod');
  assert.equal(request.idempotencyKey, 'pub-idem-1');
  assert.equal(adapter.capabilities.includes('content.publish'), true);
  assert.equal(adapter.capabilities.includes('orders.read'), false);

  const emptyPayloadAdapter = createPublishingAdapter({ platform: 'facebook', credentialsRef: 'ref:fb/x', transport: async () => ({ status: 200, payload: {} }) });
  await assert.rejects(() => emptyPayloadAdapter.publish({ text: 'hi', mediaUrls: [] }, { approvalRef: 'a', idempotencyKey: 'i' }), /missing externalId/);

  const httpFailAdapter = createPublishingAdapter({ platform: 'instagram', credentialsRef: 'ref:ig/x', transport: async () => ({ status: 500 }) });
  await assert.rejects(() => httpFailAdapter.publish({ text: 'hi', mediaUrls: [] }, { approvalRef: 'a', idempotencyKey: 'i' }), (error) => error.name === 'PublishingProviderError' && error.httpStatus === 500);
});

test('line adapter suppresses messaging without granted consent and validates messages fail-closed', async () => {
  const seen = [];
  const adapter = createLineAdapter({
    channelRef: 'ref:line/oa-main',
    transport: async (request) => {
      seen.push(request);
      return { status: 200, payload: { messageId: 'msg-1' } };
    }
  });

  assert.throws(() => createLineAdapter({ channelRef: 'raw-line-channel-token-aaaaaaaaaa', transport: async () => ({}) }), /credential reference/);
  await assert.rejects(
    () => adapter.pushMessage({ consent: { userId: 'U123', consentState: 'denied' }, message: { type: 'text', text: 'hi' }, idempotencyKey: 'i1' }),
    (error) => error.name === 'LineConsentSuppressedError' && error.code === 'CONSENT_SUPPRESSED' && error.consentState === 'denied'
  );
  await assert.rejects(
    () => adapter.pushMessage({ consent: { userId: 'U123', consentState: 'revoked' }, message: { type: 'text', text: 'hi' }, idempotencyKey: 'i1' }),
    (error) => error.code === 'CONSENT_SUPPRESSED'
  );
  await assert.rejects(() => adapter.pushMessage({ consent: null, message: { type: 'text', text: 'hi' }, idempotencyKey: 'i1' }), /consent evidence object is required/);
  await assert.rejects(() => adapter.pushMessage({ consent: { userId: '', consentState: 'granted' }, message: { type: 'text', text: 'hi' }, idempotencyKey: 'i1' }), /consent.userId is required/);
  await assert.rejects(() => adapter.pushMessage({ consent: { userId: 'U123', consentState: '' }, message: { type: 'text', text: 'hi' }, idempotencyKey: 'i1' }), (error) => error.code === 'CONSENT_SUPPRESSED' || /consent.consentState is required/.test(error.message));
  await assert.rejects(() => adapter.pushMessage({ consent: { userId: 'U123', consentState: 'granted' }, message: { type: 'text', text: 'hi' } }), /idempotencyKey is required/);
  await assert.rejects(() => adapter.pushMessage({ consent: { userId: 'U123', consentState: 'granted' }, message: { type: 'audio', text: 'hi' }, idempotencyKey: 'i1' }), /unsupported message type/);
  await assert.rejects(() => adapter.pushMessage({ consent: { userId: 'U123', consentState: 'granted' }, message: { type: 'text', text: '  ' }, idempotencyKey: 'i1' }), /message.text is required/);

  const receipt = await adapter.pushMessage({
    consent: { userId: 'U123', consentState: 'granted' },
    message: { type: 'text', text: 'your order shipped' },
    idempotencyKey: 'line-i1'
  });
  assert.deepEqual(receipt, {
    platform: 'line',
    externalId: 'msg-1',
    status: 'queued',
    provenance: { channelRef: 'ref:line/oa-main', idempotencyKey: 'line-i1' }
  });
  assert.ok(Object.isFrozen(receipt));
  const sentRequest = seen.at(-1);
  assert.equal(sentRequest.targetUserId, 'U123');
  assert.equal(sentRequest.consentState, 'granted');
  assert.equal(sentRequest.channelRef, 'ref:line/oa-main');
});

test('line webhook signature verification uses timing-safe base64 hmac comparison', () => {
  const secret = 'channelsecret';
  const rawBody = '{"events":[{"type":"follow"}]}';
  const good = createHmac('sha256', secret).update(rawBody).digest('base64');
  assert.equal(verifyLineWebhookSignature({ channelSecret: secret, rawBody, signature: good }), true);
  assert.equal(verifyLineWebhookSignature({ channelSecret: secret, rawBody: rawBody + ' ', signature: good }), false);
  assert.equal(verifyLineWebhookSignature({ channelSecret: 'other', rawBody, signature: good }), false);
  assert.throws(() => verifyLineWebhookSignature({ channelSecret: '', rawBody, signature: good }), /channelSecret is required/);
  const adapter = createLineAdapter({ channelRef: 'ref:line/x', transport: async () => ({ status: 200, payload: { id: 'm' } }) });
  assert.equal(adapter.verifyWebhookSignature({ channelSecret: secret, rawBody, signature: good }), true);
});

test('token bucket bursts then throttles with retryAfterMs', async () => {
  const policy = createRateLimitPolicy({ platform: 'shopee', requestsPerMinute: 6000, burst: 3 });
  for (let i = 0; i < 3; i++) {
    const decision = policy.tryAcquire();
    assert.equal(decision.allowed, true);
    assert.equal(decision.retryAfterMs, 0);
  }
  const blocked = policy.tryAcquire();
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
  assert.equal(policy.tryAcquire().allowed, false);
  assert.equal(policy.tryAcquire(5).retryAfterMs, null);
  assert.throws(() => policy.tryAcquire(0), /n must be a positive integer/);

  const eventual = await policy.acquire(1, { maxWaitMs: 5000 });
  assert.equal(eventual.allowed, true);

  const snapshot = policy.snapshot();
  assert.equal(snapshot.platform, 'shopee');
  assert.equal(snapshot.burst, 3);
  assert.ok(snapshot.tokensRemaining <= snapshot.burst);

  assert.throws(() => createRateLimitPolicy({ platform: 'shopee', requestsPerMinute: -1, burst: 3 }), /requestsPerMinute/);
  assert.throws(() => createRateLimitPolicy({ platform: 'shopee', requestsPerMinute: 60, burst: 0 }), /burst/);
  assert.throws(() => createRateLimitPolicy({ platform: 'shopee', requestsPerMinute: 60 }), /burst/);
  assert.throws(() => createRateLimitPolicy({ platform: 'metaverse', requestsPerMinute: 60, burst: 3 }), /unsupported rate limit platform/);

  const tinyBucket = createRateLimitPolicy({ platform: 'lazada', requestsPerMinute: 60, burst: 1 });
  await assert.rejects(() => tinyBucket.acquire(2, { maxWaitMs: 50 }), /exceeds bucket capacity/);
});

test('provider error normalization maps per-platform retryability on top of http heuristics', () => {
  const shopeeRateLimited = normalizeProviderError({ platform: 'shopee', status: 400, code: 'error_ratelimit', message: 'too many requests' });
  assert.equal(shopeeRateLimited.retryable, true);
  assert.equal(shopeeRateLimited.category, 'rate_limit');
  assert.equal(normalizeProviderError({ platform: 'shopee', status: 500, code: 'error_param', message: 'bad param' }).retryable, false);
  assert.equal(normalizeProviderError({ platform: 'shopee', status: 403, code: '40300011', message: 'forbidden' }).category, 'permission_denied');

  const lazadaLimited = normalizeProviderError({ platform: 'lazada', status: 400, code: '7', message: 'app call limited' });
  assert.equal(lazadaLimited.retryable, true);
  assert.equal(lazadaLimited.category, 'rate_limit');
  assert.equal(normalizeProviderError({ platform: 'lazada', status: 200, code: '25', message: 'bad signature' }).retryable, false);
  assert.equal(normalizeProviderError({ platform: 'lazada', status: 200, code: '8', message: 'remote service error' }).retryable, true);
  assert.equal(normalizeProviderError({ platform: 'lazada', status: 200, code: '8', message: 'remote service error' }).category, 'server_error');

  assert.equal(normalizeProviderError({ platform: 'shopee', status: 429, code: 'unknown-code' }).retryable, true);
  assert.equal(normalizeProviderError({ platform: 'shopee', status: 400, code: 'unknown-code' }).retryable, false);
  assert.equal(normalizeProviderError({ platform: 'lazada', status: 503, code: null }).retryable, true);
  assert.equal(normalizeProviderError({ platform: 'lazada', status: 503, code: null }).category, 'transient_http');

  const normalized = normalizeProviderError({ platform: 'shopee', status: 400, code: 'error_auth', requestId: 'req-1' });
  assert.deepEqual(Object.keys(normalized).sort(), ['category', 'code', 'httpStatus', 'message', 'platform', 'requestId', 'retryable']);
  assert.ok(Object.isFrozen(normalized));

  assert.throws(() => normalizeProviderError({ platform: 'beacon', status: 500 }), /unsupported adapter platform/);
  assert.deepEqual(Object.keys(ProviderErrorCodePolicy).sort(), ['lazada', 'shopee']);
});
