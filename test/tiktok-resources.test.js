import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResilientInvoker, classifyRetry } from '../packages/tiktok-shop/src/resilience.js';
import { createCursorPaginator, normalizePage } from '../packages/tiktok-shop/src/pagination.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../packages/tiktok-shop/src/event-dedupe.js';
import {
  TIKTOK_RESOURCES,
  listResourceGroups,
  getResource,
  createAffiliateCreatorApi,
  createAffiliatePartnerApi,
  createAffiliateSellerApi,
  createAnalyticsApi,
  createAuthorizationApi,
  createProductApi,
  createOrderApi,
  createFinanceApi,
  createFulfillmentApi,
  createLogisticsApi,
  createPromotionApi,
  createReturnRefundApi,
  createCustomerServiceApi,
  createSupplyChainApi
} from '../packages/tiktok-shop/src/resources.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('resilient invoker times out hanging operations with normalized timeout error', async () => {
  const invoker = createResilientInvoker({ timeoutMs: 10, maxRetries: 0, baseDelayMs: 1, maxDelayMs: 2, breakerThreshold: 100, breakerResetMs: 1000 });
  await assert.rejects(() => invoker.invoke(async () => new Promise(() => {})), (error) => {
    assert.equal(error.code, 'timeout');
    assert.equal(error.retryable, true);
    assert.equal(error.httpStatus, 0);
    return true;
  });
});

test('resilient invoker retries retryable failures and preserves result and status', async () => {
  let attempts = 0;
  const invoker = createResilientInvoker({ timeoutMs: 200, maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2, breakerThreshold: 100, breakerResetMs: 1000 });
  const result = await invoker.invoke(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('rate limited');
      error.retryable = true;
      error.httpStatus = 429;
      throw error;
    }
    return { ok: attempts };
  });
  assert.deepEqual(result, { ok: 3 });
  assert.equal(attempts, 3);
});

test('resilient invoker exhausts bounded retries and normalizes the final error', async () => {
  let attempts = 0;
  const invoker = createResilientInvoker({ timeoutMs: 50, maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, breakerThreshold: 100, breakerResetMs: 1000 });
  await assert.rejects(() => invoker.invoke(async () => {
    attempts += 1;
    const error = new Error('upstream down');
    error.retryable = true;
    error.httpStatus = 503;
    throw error;
  }), (error) => {
    assert.equal(error.code, 'operation_failed');
    assert.equal(error.retryable, true);
    assert.equal(error.httpStatus, 503);
    return true;
  });
  assert.equal(attempts, 3);
});

test('resilient invoker does not retry non-retryable failures', async () => {
  let attempts = 0;
  const invoker = createResilientInvoker({ timeoutMs: 50, maxRetries: 5, baseDelayMs: 1, maxDelayMs: 2, breakerThreshold: 100, breakerResetMs: 1000 });
  await assert.rejects(() => invoker.invoke(async () => {
    attempts += 1;
    throw new Error('bad request');
  }), (error) => {
    assert.equal(error.code, 'operation_failed');
    assert.equal(error.retryable, false);
    assert.equal(error.httpStatus, 0);
    return true;
  });
  assert.equal(attempts, 1);
});

test('classifyRetry is fail-closed for non-retryable inputs', () => {
  assert.equal(classifyRetry(null), false);
  assert.equal(classifyRetry(undefined), false);
  assert.equal(classifyRetry('nope'), false);
  assert.equal(classifyRetry(new Error('plain')), false);
  const retryable = new Error('flagged');
  retryable.retryable = true;
  assert.equal(classifyRetry(retryable), true);
});

test('resilient invoker validates its configuration fail-closed', () => {
  assert.throws(() => createResilientInvoker({ timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => createResilientInvoker({ maxRetries: -1 }), /maxRetries/);
  assert.throws(() => createResilientInvoker({ baseDelayMs: 10, maxDelayMs: 5 }), /maxDelayMs/);
  assert.throws(() => createResilientInvoker({ breakerThreshold: 0 }), /breakerThreshold/);
});

test('resilient invoker rejects non-function operations', async () => {
  const invoker = createResilientInvoker();
  await assert.rejects(() => invoker.invoke(null), TypeError);
});

test('circuit breaker opens after consecutive failures, fails fast, then half-opens after reset', async () => {
  let attempts = 0;
  const invoker = createResilientInvoker({ timeoutMs: 50, maxRetries: 0, baseDelayMs: 1, maxDelayMs: 2, breakerThreshold: 2, breakerResetMs: 40 });
  const fail = () => invoker.invoke(async () => {
    attempts += 1;
    throw new Error('boom');
  });
  await assert.rejects(fail, /boom/);
  await assert.rejects(fail, /boom/);
  assert.equal(attempts, 2);
  await assert.rejects(fail, (error) => {
    assert.equal(error.code, 'circuit_open');
    return true;
  });
  assert.equal(attempts, 2);
  await sleep(55);
  await assert.rejects(fail, /boom/);
  assert.equal(attempts, 3);
  await assert.rejects(fail, (error) => {
    assert.equal(error.code, 'circuit_open');
    return true;
  });
  await sleep(55);
  const recovered = await invoker.invoke(async () => {
    attempts += 1;
    return 'recovered';
  });
  assert.equal(recovered, 'recovered');
  assert.equal(attempts, 4);
  assert.equal(await invoker.invoke(async () => 'steady'), 'steady');
});

test('cursor paginator collects all pages until null cursor', async () => {
  const pages = [
    { items: [1, 2], nextCursor: 'a' },
    { items: [3], nextCursor: 'b' },
    { items: [4], nextCursor: null }
  ];
  const requests = [];
  const paginator = createCursorPaginator({
    fetchPage: async (request) => {
      requests.push(request);
      return pages[requests.length - 1];
    },
    pageSize: 2,
    maxPages: 10
  });
  const collected = await paginator.collectAll();
  assert.deepEqual(collected, [1, 2, 3, 4]);
  assert.deepEqual(requests.map((request) => request.cursor), [null, 'a', 'b']);
  assert.ok(requests.every((request) => request.pageSize === 2));
});

test('cursor paginator enforces the hard page cap', async () => {
  const paginator = createCursorPaginator({
    fetchPage: async () => ({ items: ['x'], nextCursor: 'next' }),
    pageSize: 1,
    maxPages: 3
  });
  await assert.rejects(() => paginator.collectAll(), /hard page cap of 3/);
});

test('iterate yields normalized frozen pages in order', async () => {
  const paginator = createCursorPaginator({
    fetchPage: async ({ cursor }) => ({ items: [cursor ?? 'first'], nextCursor: cursor ? null : 'second' }),
    pageSize: 5,
    maxPages: 5
  });
  const seen = [];
  for await (const page of paginator.iterate()) {
    assert.ok(Object.isFrozen(page));
    assert.ok(Object.isFrozen(page.items));
    seen.push(page.items[0]);
  }
  assert.deepEqual(seen, ['first', 'second']);
});

test('paginator rejects malformed pages fail-closed', async () => {
  const malformed = [null, undefined, 'page', 42, [], {}, { items: 'nope', nextCursor: 'x' }, { nextCursor: 'y' }];
  for (const bad of malformed) {
    const paginator = createCursorPaginator({ fetchPage: async () => bad, pageSize: 1, maxPages: 2 });
    await assert.rejects(() => paginator.collectAll());
  }
});

test('paginator validates configuration and normalizePage shape', () => {
  assert.throws(() => createCursorPaginator({ fetchPage: 'nope' }), /fetchPage must be a function/);
  assert.throws(() => createCursorPaginator({ fetchPage: async () => ({ items: [] }), pageSize: 0 }), /pageSize/);
  assert.throws(() => createCursorPaginator({ fetchPage: async () => ({ items: [] }), maxPages: 0 }), /maxPages/);
  assert.throws(() => normalizePage(null), TypeError);
  assert.throws(() => normalizePage({ items: null }), TypeError);
  const page = normalizePage({ items: [1], nextCursor: 'c' });
  assert.deepEqual(page, { items: [1], nextCursor: 'c' });
  assert.ok(Object.isFrozen(page) && Object.isFrozen(page.items));
  assert.equal(normalizePage({ items: [] }).nextCursor, null);
  assert.equal(normalizePage({ items: [], nextCursor: '' }).nextCursor, null);
});

test('dedupe store returns first-time semantics', () => {
  const store = createEventDedupeStore();
  assert.ok(Object.isFrozen(store));
  assert.equal(store.seen('evt-1'), false);
  assert.equal(store.record('evt-1', { tenantId: 'tenant-a', receivedAt: Date.now() }), true);
  assert.equal(store.seen('evt-1'), true);
  assert.equal(store.record('evt-1', { tenantId: 'tenant-a' }), false);
  assert.equal(store.record('evt-2'), true);
  assert.equal(store.seen('evt-2'), true);
});

test('dedupe store rejects empty event ids and bad meta', () => {
  const store = createEventDedupeStore();
  assert.throws(() => store.seen(''), /eventId is required/);
  assert.throws(() => store.seen('   '), /eventId is required/);
  assert.throws(() => store.record(null), /eventId is required/);
  assert.throws(() => store.record('evt-3', 'meta'), TypeError);
  assert.throws(() => createEventDedupeStore({ ttlMs: 0 }), /ttlMs/);
});

test('dedupe entries expire after ttl and become first-time again', async () => {
  const store = createEventDedupeStore({ ttlMs: 15 });
  store.record('evt-ttl');
  assert.equal(store.seen('evt-ttl'), true);
  assert.equal(store.record('evt-ttl'), false);
  await sleep(30);
  assert.equal(store.seen('evt-ttl'), false);
  assert.equal(store.record('evt-ttl'), true);
});

test('dedupe accepts second-granularity receivedAt timestamps', () => {
  const store = createEventDedupeStore();
  store.record('evt-secs', { receivedAt: Math.floor(Date.now() / 1000) });
  assert.equal(store.seen('evt-secs'), true);
});

test('dedupe expiry follows one injected clock instead of mixing wall time', () => {
  let current = 1_760_000_000_000;
  const store = createEventDedupeStore({ ttlMs: 60_000, now: () => current });
  store.record('evt-clock', { receivedAt: current });
  assert.equal(store.seen('evt-clock'), true);
  current += 59_000;
  assert.equal(store.seen('evt-clock'), true);
  current += 2_000;
  assert.equal(store.seen('evt-clock'), false);
  assert.equal(store.record('evt-clock', { receivedAt: current }), true);
  assert.equal(store.seen('evt-clock'), true);
});

test('replay guard dedupes on a frozen timeline without wall-clock drift', () => {
  const nowMs = new Date('2026-08-24T12:00:00.000Z').getTime();
  const guard = createWebhookReplayGuard({
    dedupeStore: createEventDedupeStore({ now: () => nowMs }),
    windowSeconds: 300
  });
  const first = guard.decide({ eventId: 'evt-frozen', timestamp: nowMs, nowMs, tenantId: 'tenant-a' });
  assert.equal(first.accepted, true);
  const replay = guard.decide({ eventId: 'evt-frozen', timestamp: nowMs, nowMs, tenantId: 'tenant-a' });
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, 'duplicate_event');
  assert.equal(replay.duplicate, true);
});

test('replay guard enforces the freshness window on both sides', () => {
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 300 });
  const nowMs = Date.now();
  const stale = guard.decide({ eventId: 'evt-old', timestamp: nowMs - 400_000, nowMs });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'timestamp_outside_window');
  assert.equal(stale.fresh, false);
  const future = guard.decide({ eventId: 'evt-future', timestamp: nowMs + 400_000, nowMs });
  assert.equal(future.accepted, false);
  const edge = guard.decide({ eventId: 'evt-edge', timestamp: nowMs - 299_000, nowMs });
  assert.equal(edge.accepted, true);
});

test('replay guard dedupes event ids inside the window', () => {
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 300 });
  const nowMs = Date.now();
  const first = guard.decide({ eventId: 'evt-dup', timestamp: nowMs - 1000, nowMs, tenantId: 'tenant-a' });
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  const replay = guard.decide({ eventId: 'evt-dup', timestamp: nowMs - 1000, nowMs, tenantId: 'tenant-a' });
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, 'duplicate_event');
  assert.equal(replay.duplicate, true);
});

test('replay guard does not consume event ids rejected as stale', () => {
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 60 });
  const nowMs = Date.now();
  assert.equal(guard.decide({ eventId: 'evt-recycle', timestamp: nowMs - 120_000, nowMs }).accepted, false);
  assert.equal(guard.decide({ eventId: 'evt-recycle', timestamp: nowMs, nowMs }).accepted, true);
});

test('replay guard validates configuration and inputs', () => {
  assert.throws(() => createWebhookReplayGuard({}), /dedupeStore/);
  assert.throws(() => createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 0 }), /windowSeconds/);
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore() });
  assert.throws(() => guard.decide({ eventId: '' , timestamp: Date.now() }), /eventId is required/);
  assert.throws(() => guard.decide({ eventId: 'x' }), /timestamp is required/);
});

const API_FACTORIES = Object.freeze({
  affiliateCreator: createAffiliateCreatorApi,
  affiliatePartner: createAffiliatePartnerApi,
  affiliateSeller: createAffiliateSellerApi,
  analytics: createAnalyticsApi,
  authorization: createAuthorizationApi,
  product: createProductApi,
  order: createOrderApi,
  finance: createFinanceApi,
  fulfillment: createFulfillmentApi,
  logistics: createLogisticsApi,
  promotion: createPromotionApi,
  returnRefund: createReturnRefundApi,
  customerService: createCustomerServiceApi,
  supplyChain: createSupplyChainApi
});

const EXPECTED_GROUPS = ['affiliateCreator', 'affiliatePartner', 'affiliateSeller', 'analytics', 'authorization', 'customerService', 'finance', 'fulfillment', 'logistics', 'order', 'product', 'promotion', 'returnRefund', 'supplyChain'];

test('resource registry lists all fourteen parity matrix groups', () => {
  const groups = listResourceGroups();
  assert.equal(groups.length, 14);
  assert.deepEqual([...groups].sort(), EXPECTED_GROUPS);
  assert.deepEqual(Object.keys(TIKTOK_RESOURCES).sort(), EXPECTED_GROUPS);
  for (const group of groups) {
    const entry = getResource(group);
    assert.ok(Object.isFrozen(entry));
    assert.ok(entry.methods.length >= 1);
    assert.equal(typeof API_FACTORIES[group], 'function');
  }
});

test('getResource fails closed for unknown groups', () => {
  assert.throws(() => getResource('galaxy'), /unsupported tiktok resource group/);
  assert.throws(() => getResource(''), /unsupported tiktok resource group/);
  assert.equal(getResource('order').methods.includes('ship'), true);
});

test('resource apis require a transport function', () => {
  for (const factory of Object.values(API_FACTORIES)) {
    assert.throws(() => factory({}), /transport is required/);
  }
});

test('every mutating resource call fails closed without idempotencyKey', async () => {
  let transportCalls = 0;
  const transport = async () => {
    transportCalls += 1;
    return { ok: true };
  };
  let checked = 0;
  for (const group of listResourceGroups()) {
    const api = API_FACTORIES[group]({ transport });
    for (const methodName of getResource(group).mutatingMethods) {
      await assert.rejects(() => api[methodName]({}), /idempotencyKey is required/);
      await assert.rejects(() => api[methodName]({ idempotencyKey: '   ' }), /idempotencyKey is required/);
      await assert.rejects(() => api[methodName]({ idempotencyKey: null }), /idempotencyKey is required/);
      checked += 1;
    }
  }
  assert.ok(checked >= 9);
  assert.equal(transportCalls, 0);
});

test('mutating resource calls pass idempotencyKey through to transport on success', async () => {
  const seen = [];
  const transport = async (request) => {
    seen.push(request);
    return { ok: true, path: request.path };
  };
  for (const group of listResourceGroups()) {
    const api = API_FACTORIES[group]({ transport });
    for (const methodName of getResource(group).mutatingMethods) {
      const response = await api[methodName]({ idempotencyKey: `idem-${group}-${methodName}`, payload: 1 });
      assert.equal(response.ok, true);
    }
  }
  assert.ok(seen.length > 0);
  for (const request of seen) {
    assert.match(request.path, /^\//);
    assert.equal(request.method, 'POST');
    assert.match(request.idempotencyKey, /^idem-/);
    assert.equal('idempotencyKey' in request.params, false);
    assert.ok(Object.isFrozen(request));
  }
});

test('read resource calls pass through path, method, params and null idempotencyKey', async () => {
  const requests = [];
  const transport = async (request) => {
    requests.push(request);
    return { ok: true };
  };
  const product = createProductApi({ transport });
  await product.search({ keyword: 'lamp' });
  await product.detail({ productId: 'p-1' });
  const order = createOrderApi({ transport });
  await order.list({ pageSize: 10 });
  await order.ship({ orderId: 'o-9', trackingNumber: 'tn-1', idempotencyKey: 'ship-key-1' });
  assert.deepEqual(requests, [
    { path: '/product/search', method: 'POST', params: { keyword: 'lamp' }, idempotencyKey: null },
    { path: '/product/detail', method: 'GET', params: { productId: 'p-1' }, idempotencyKey: null },
    { path: '/order/search', method: 'GET', params: { pageSize: 10 }, idempotencyKey: null },
    { path: '/order/ship', method: 'POST', params: { orderId: 'o-9', trackingNumber: 'tn-1' }, idempotencyKey: 'ship-key-1' }
  ]);
});

test('parity rows expose their required operations', () => {
  const finance = getResource('finance').methods;
  assert.deepEqual(['settlements', 'listings'].every((m) => finance.includes(m)), true);
  const fulfillment = getResource('fulfillment').mutatingMethods;
  assert.deepEqual(['createPackage', 'shipPackage'].every((m) => fulfillment.includes(m)), true);
  assert.ok(getResource('promotion').methods.includes('create'));
  assert.ok(getResource('returnRefund').methods.includes('approve'));
  assert.ok(getResource('analytics').methods.includes('dashboard'));
  assert.ok(getResource('authorization').methods.includes('getSellerInfo'));
  for (const group of ['affiliateCreator', 'affiliatePartner', 'affiliateSeller']) {
    const methods = getResource(group).methods;
    assert.ok(methods.some((m) => m.toLowerCase().includes('campaign')));
    assert.ok(methods.some((m) => m.toLowerCase().includes('order')));
  }
});

test('resource params are validated fail-closed', async () => {
  const transport = async () => ({ ok: true });
  const analytics = createAnalyticsApi({ transport });
  await assert.rejects(() => analytics.dashboard(42), /params must be an object/);
  await assert.rejects(() => analytics.dashboard('nope'), /params must be an object/);
});
