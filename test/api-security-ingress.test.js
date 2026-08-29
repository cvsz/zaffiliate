import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../apps/api/src/server.js';
import { createAffiliateRuntime } from '../packages/affiliate-core/src/runtime.js';
import { createIngressRateLimiter } from '../packages/security/src/rate-limit-api.js';
import { createSecurityEventRecorder } from '../packages/security/src/security-events.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';

function harness() {
  const runtime = createAffiliateRuntime();
  const product = runtime.registerProduct('org-A', { platform: 'tiktok', externalProductId: 'p', title: 'T' });
  const offer = runtime.publishOffer('org-A', { productId: product.productId, price: 1000, currency: 'THB', commissionRate: 0.1 });
  const link = runtime.generateLink('org-A', { offerId: offer.offerId, destinationUrl: 'https://shop.example.com/x', slug: 's1' });
  return { runtime, link };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('redirect ingress throttles beyond burst with retry-after and records the event', async (t) => {
  const { runtime, link } = harness();
  const events = [];
  const recorder = createSecurityEventRecorder({ sink: (event) => events.push(event), clock: () => new Date().toISOString() });
  const tightLimiter = createIngressRateLimiter({ requestsPerMinute: 60, burst: 2 });
  const server = buildServer({
    env: { APP_ENV: 'development' },
    runtime,
    rateLimiter: tightLimiter,
    securityEvents: recorder
  });
  t.after(() => server.close());
  const port = await listen(server);

  const url = `http://127.0.0.1:${port}/go/${link.slug}`;
  const first = await fetch(url, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });
  const second = await fetch(url, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });
  const third = await fetch(url, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });

  assert.equal(first.status, 302);
  assert.equal(second.status, 302);
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) >= 1);
  const body = await third.json();
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.equal(body.error.request_id, third.headers.get('x-request-id'));
  assert.equal(recorder.count('RATE_LIMITED'), 1);
});

test('throttling is per tenant+route key and does not leak across tenants or routes', async (t) => {
  const { runtime, link } = harness();
  runtime.generateLink('org-B', { offerId: offerIdFor(runtime, 'org-B'), destinationUrl: 'https://shop.example.com/b', slug: 's1b' }).slug;
  function offerIdFor(rt, tenant) {
    const product = rt.registerProduct(tenant, { platform: 'tiktok', externalProductId: `p-${tenant}`, title: 'T' });
    return rt.publishOffer(tenant, { productId: product.productId, price: 1000, currency: 'THB', commissionRate: 0.1 }).offerId;
  }
  const tight = createIngressRateLimiter({ requestsPerMinute: 60, burst: 1 });
  const server = buildServer({ env: { APP_ENV: 'development' }, runtime, rateLimiter: tight });
  t.after(() => server.close());
  const port = await listen(server);

  await fetch(`http://127.0.0.1:${port}/go/${link.slug}`, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });
  const blockedSameKey = await fetch(`http://127.0.0.1:${port}/go/${link.slug}`, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });
  assert.equal(blockedSameKey.status, 429);

  const otherTenant = await fetch(`http://127.0.0.1:${port}/go/s1b`, { headers: { 'x-tenant-id': 'org-B' }, redirect: 'manual' });
  assert.equal(otherTenant.status, 302);
});

test('invalid webhook signatures are rejected AND recorded as security events', async (t) => {
  const { runtime, link } = harness();
  const events = [];
  const recorder = createSecurityEventRecorder({ sink: (event) => events.push(event), clock: () => new Date().toISOString() });
  const backend = createInMemorySecretBackend();
  backend.put('ref:webhooks/shopee', 'shopee-webhook-secret');
  const server = buildServer({
    env: { APP_ENV: 'development' },
    runtime,
    securityEvents: recorder,
    webhookSecrets: createSecretManager({ backend })
  });
  t.after(() => server.close());
  const port = await listen(server);

  const rawBody = JSON.stringify({ orderRef: 'o1', revenueMinorUnits: 500, currency: 'THB', subId: link.subIds.subid });
  const response = await fetch(`http://127.0.0.1:${port}/webhooks/shopee`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': 'org-A',
      'x-zaff-signature': 'sha256=deadbeef'.padEnd(71, '0'),
      'x-zaff-timestamp': String(Date.now()),
      'x-zaff-event-id': 'evt-sec-1'
    },
    body: rawBody
  });
  assert.equal(response.status, 401);
  assert.equal(recorder.count('WEBHOOK_SIGNATURE_FAILURE'), 1);
  assert.equal(events[0].severity, 'MEDIUM');
});
