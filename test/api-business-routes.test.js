import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../apps/api/src/server.js';
import { resolveRedirect, ingestWebhook } from '../apps/api/src/business.js';
import { createAffiliateRuntime } from '../packages/affiliate-core/src/runtime.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../packages/tiktok-shop/src/event-dedupe.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';
import { computeTikTokWebhookSignature } from '../packages/tiktok-shop/src/webhook.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const TENANT = 'tenant-A';

function seedRuntime() {
  const runtime = createAffiliateRuntime({ clock: () => NOW });
  const product = runtime.registerProduct(TENANT, { platform: 'tiktok', externalProductId: 'p-1', title: 'Gadget' });
  const offer = runtime.publishOffer(TENANT, { productId: product.productId, price: 150000, currency: 'THB', commissionRate: 0.1 });
  const link = runtime.generateLink(TENANT, {
    offerId: offer.offerId,
    destinationUrl: 'https://shop.example.com/p/gadget',
    slug: 'summer-drop'
  });
  return { runtime, offer, link };
}

function buildHarness({ now = NOW } = {}) {
  const runtime = createAffiliateRuntime({ clock: () => now });
  const link = (() => {
    const product = runtime.registerProduct(TENANT, { platform: 'tiktok', externalProductId: 'p-1', title: 'Gadget' });
    const offer = runtime.publishOffer(TENANT, { productId: product.productId, price: 150000, currency: 'THB', commissionRate: 0.1 });
    return runtime.generateLink(TENANT, { offerId: offer.offerId, destinationUrl: 'https://shop.example.com/p/gadget', slug: 'summer-drop' });
  })();
  const backend = createInMemorySecretBackend();
  backend.put('ref:webhooks/shopee', 'shopee-webhook-secret');
  backend.put('ref:webhooks/tiktok/appKey', 'test-app-key');
  backend.put('ref:webhooks/tiktok/appSecret', 'tiktok-webhook-secret');
  const secrets = createSecretManager({ backend });
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 300 });
  return { runtime, link, secrets, guard, now };
}

test('redirect resolves an existing slug, records attribution and returns the deep link', () => {
  const { runtime, link } = buildHarness();
  const decision = resolveRedirect({ runtime, tenantId: TENANT, slug: 'summer-drop', now: NOW, visitorHash: 'abcd1234abcd1234' });
  assert.equal(decision.status, 302);
  assert.equal(decision.location, link.deepLinkUrl);
  assert.ok(decision.clickId.startsWith('clk_'));
});

test('unknown slugs and foreign-tenant slugs are indistinguishable 404s', () => {
  const { runtime } = buildHarness();
  assert.equal(resolveRedirect({ runtime, tenantId: TENANT, slug: 'nope', now: NOW }).status, 404);
  assert.equal(resolveRedirect({ runtime, tenantId: 'tenant-B', slug: 'summer-drop', now: NOW }).status, 404);
});

test('expired links answer 410 gone instead of redirecting', () => {
  const { runtime } = buildHarness();
  const product = runtime.registerProduct(TENANT, { platform: 'tiktok', externalProductId: 'p-2', title: 'Old' });
  const offer = runtime.publishOffer(TENANT, { productId: product.productId, price: 100, currency: 'THB', commissionRate: 0.05 });
  runtime.generateLink(TENANT, { offerId: offer.offerId, destinationUrl: 'https://shop.example.com/old', slug: 'dead-drop', expiresAt: '2026-08-24T00:00:00.000Z' });
  assert.equal(resolveRedirect({ runtime, tenantId: TENANT, slug: 'dead-drop', now: NOW }).status, 410);
});

test('tampered destinations fail closed even if resolution returns corrupted data', () => {
  const { link } = buildHarness();
  const poisonedRuntime = {
    resolveLinkBySlug: () => ({ ...link, deepLinkUrl: link.deepLinkUrl.replace('https:', 'javascript:') })
  };
  assert.equal(resolveRedirect({ runtime: poisonedRuntime, tenantId: TENANT, slug: 'summer-drop', now: NOW }).status, 404);
});

function signedBody(secret, rawBody, timestamp) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `sha256=${signature}`;
}

function shopeePayload(overrides = {}) {
  return JSON.stringify({
    orderRef: 'ord-100',
    revenueMinorUnits: 250000,
    currency: 'THB',
    subId: 'subid-token',
    ...overrides
  });
}

test('signed webhook ingests a conversion against the sub-attributed link', () => {
  const { runtime, secrets, guard, link } = buildHarness();
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'shopee', tenantId: TENANT,
    rawBody: shopeePayload({ subId: link.subIds.subid }), signature: signedBody('shopee-webhook-secret', shopeePayload({ subId: link.subIds.subid }), String(NOW)),
    timestamp: String(NOW), eventId: 'evt-1', now: NOW
  });
  assert.equal(result.status, 202);
  const events = runtime.drainOutbox(TENANT);
  assert.ok(events.some((event) => event.type === 'conversion.recorded'));
});

test('replayed deliveries are deduped and never double-count conversions', () => {
  const { runtime, secrets, guard, link } = buildHarness();
  const rawBody = shopeePayload({ subId: link.subIds.subid });
  const input = {
    runtime, secrets, guard, platform: 'shopee', tenantId: TENANT,
    rawBody, signature: signedBody('shopee-webhook-secret', rawBody, String(NOW)), timestamp: String(NOW), eventId: 'evt-dup', now: NOW
  };
  assert.equal(ingestWebhook(input).status, 202);
  const replay = ingestWebhook(input);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  const conversions = runtime.drainOutbox(TENANT).filter((event) => event.type === 'conversion.recorded');
  assert.equal(conversions.length, 1);
});

test('invalid signatures fail closed with 401 before any state change', () => {
  const { runtime, secrets, guard, link } = buildHarness();
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'shopee', tenantId: TENANT,
    rawBody: shopeePayload({ subId: link.subIds.subid }), signature: 'sha256=deadbeef'.padEnd(71, '0'), timestamp: String(NOW), eventId: 'evt-bad', now: NOW
  });
  assert.equal(result.status, 401);
  const stateChanges = runtime.drainOutbox(TENANT).filter((event) => ['click.recorded', 'conversion.recorded'].includes(event.type));
  assert.equal(stateChanges.length, 0);
});

test('stale timestamps outside the replay window are rejected', () => {
  const { runtime, secrets, guard, link } = buildHarness();
  const stale = NOW - 10 * 60 * 1000;
  const rawBody = shopeePayload({ subId: link.subIds.subid });
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'shopee', tenantId: TENANT,
    rawBody, signature: signedBody('shopee-webhook-secret', rawBody, String(stale)), timestamp: String(stale), eventId: 'evt-stale', now: NOW
  });
  assert.equal(result.status, 400);
});

test('tiktok deliveries verify through the canonical tiktok scheme', () => {
  const { runtime, secrets, guard, link } = buildHarness();
  const rawBody = shopeePayload({ subId: link.subIds.subid });
  const signature = computeTikTokWebhookSignature({ appKey: 'test-app-key', appSecret: 'tiktok-webhook-secret', rawBody });
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'tiktok', tenantId: TENANT,
    rawBody, signature, timestamp: String(NOW), eventId: 'evt-tt-1', now: NOW
  });
  assert.equal(result.status, 202);
});

test('unconfigured platforms answer 404 and never reach verification', () => {
  const { runtime, secrets, guard } = buildHarness();
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'myspace', tenantId: TENANT,
    rawBody: '{}', signature: 'sha256=00', timestamp: String(NOW), eventId: 'evt-x', now: NOW
  });
  assert.equal(result.status, 404);
});

test('payloads that do not reference a known link are unprocessable', () => {
  const { runtime, secrets, guard } = buildHarness();
  const rawBody = shopeePayload({ subId: 'unknown-sub-token' });
  const result = ingestWebhook({
    runtime, secrets, guard, platform: 'shopee', tenantId: TENANT,
    rawBody, signature: signedBody('shopee-webhook-secret', rawBody, String(NOW)), timestamp: String(NOW), eventId: 'evt-orphan', now: NOW
  });
  assert.equal(result.status, 422);
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('http surface exposes /go/:slug with privacy-conscious visitor hashing and tenant gating', async (t) => {
  const { runtime, secrets, guard, link } = buildHarness({ now: Date.now() });
  const server = buildServer({ env: { APP_ENV: 'development', DATABASE_URL: 'postgresql://zaffiliate:zaffiliate@127.0.0.1:5432/zaffiliate', REDIS_URL: 'redis://127.0.0.1:6379/0' }, runtime, webhookSecrets: secrets, webhookGuard: guard });
  t.after(() => server.close());
  const port = await listen(server);

  const denied = await fetch(`http://127.0.0.1:${port}/go/summer-drop`);
  assert.equal(denied.status, 404);

  const ok = await fetch(`http://127.0.0.1:${port}/go/${encodeURIComponent('summer-drop')}`, { headers: { 'x-tenant-id': TENANT }, redirect: 'manual' });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), link.deepLinkUrl);

  const clicks = runtime.drainOutbox(TENANT).filter((event) => event.type === 'click.recorded');
  assert.equal(clicks.length, 1);
});

test('http webhook endpoint accepts verified deliveries end-to-end', async (t) => {
  const { runtime, secrets, guard, link, now } = buildHarness({ now: Date.now() });
  const server = buildServer({ env: { APP_ENV: 'development', DATABASE_URL: 'postgresql://zaffiliate:zaffiliate@127.0.0.1:5432/zaffiliate', REDIS_URL: 'redis://127.0.0.1:6379/0' }, runtime, webhookSecrets: secrets, webhookGuard: guard });
  t.after(() => server.close());
  const port = await listen(server);
  const rawBody = shopeePayload({ subId: link.subIds.subid });
  const response = await fetch(`http://127.0.0.1:${port}/webhooks/shopee`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': TENANT,
      'x-zaff-signature': signedBody('shopee-webhook-secret', rawBody, String(now)),
      'x-zaff-timestamp': String(now),
      'x-zaff-event-id': 'evt-http-1'
    },
    body: rawBody
  });
  assert.equal(response.status, 202);
  assert.ok(runtime.drainOutbox(TENANT).some((event) => event.type === 'conversion.recorded'));
});
