import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { buildServer } from '../apps/api/src/server.js';
import { createAffiliateRuntime } from '../packages/affiliate-core/src/runtime.js';
import { createCommerceStore } from '../packages/affiliate-core/src/commerce.js';
import { createEventStore } from '../packages/analytics/src/events.js';
import { createFeatureStore, defineBaselineRanker } from '../packages/intelligence/src/index.js';
import { createRecommendationStore, createPredictionStore } from '../packages/intelligence/src/stores.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../packages/tiktok-shop/src/event-dedupe.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';
import { buildEventEnvelope } from '../packages/analytics/src/events.js';

const NOW_MS = new Date('2026-08-25T12:00:00.000Z').getTime();
const clock = () => NOW_MS;
const A = 'org-A';
const B = 'org-B';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function seedTenant(runtime, commerceStore, analyticsEvents, tenant, tag) {
  const product = runtime.registerProduct(tenant, { platform: 'tiktok', externalProductId: `xp-${tag}`, title: `Gadget ${tag}` });
  const offer = runtime.publishOffer(tenant, { productId: product.productId, price: 150000, currency: 'THB', commissionRate: 0.1 });
  const link = runtime.generateLink(tenant, {
    offerId: offer.offerId,
    destinationUrl: `https://shop.example.com/p/${tag}`,
    slug: `${tag}-drop`
  });
  commerceStore.upsertOffer(tenant, {
    provider: 'tiktok', providerOfferId: `prov-${tag}`, merchantId: `m-${tag}`, productId: product.productId,
    currency: 'THB', listPriceMinorUnits: 150000, salePriceMinorUnits: tag === 'a' ? 99000 : 120000,
    inventoryStatus: 'IN_STOCK', source: 'sync', commissionRate: 0.12, verifiedAt: new Date(NOW_MS).toISOString()
  });
  for (let i = 0; i < 40; i += 1) {
    analyticsEvents.ingest(buildEventEnvelope({
      organizationId: tenant, provider: 'tiktok', type: 'affiliate_click_recorded',
      sourceType: 'FIRST_PARTY', occurredAt: new Date(NOW_MS).toISOString(),
      externalEventId: `${tag}-clk-${i}`, productId: product.productId,
      affiliateLinkId: link.linkId, payload: { rehearsal: true }
    }));
    if (i < 4) {
      analyticsEvents.ingest(buildEventEnvelope({
        organizationId: tenant, provider: 'tiktok', type: 'commission_reported',
        sourceType: 'AFFILIATE_PROVIDER_REPORTED', occurredAt: new Date(NOW_MS).toISOString(),
        externalEventId: `${tag}-cnv-${i}`, productId: product.productId,
        payload: { status: 'approved', amountMinorUnits: tag === 'a' ? 500 : 700, currency: 'THB' }
      }));
    }
  }
  return { product, offer, link };
}

function goldenHarness() {
  const runtime = createAffiliateRuntime({ clock });
  const commerceStore = createCommerceStore({ clock });
  const analyticsEvents = createEventStore();
  const featureStore = createFeatureStore({ clock });
  const recommendationStore = createRecommendationStore({ clock });
  const predictionStore = createPredictionStore({ clock });
  const backend = createInMemorySecretBackend();
  backend.put('ref:webhooks/shopee', 'shopee-webhook-secret');
  const seededA = seedTenant(runtime, commerceStore, analyticsEvents, A, 'a');
  const seededB = seedTenant(runtime, commerceStore, analyticsEvents, B, 'b');
  const server = buildServer({
    env: { APP_ENV: 'development' },
    runtime,
    commerceStore,
    analyticsEvents,
    featureStore,
    recommendationStore,
    predictionStore,
    ranker: defineBaselineRanker({ featureStore }),
    webhookGuard: createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 300 }),
    webhookSecrets: createSecretManager({ backend })
  });
  return { server, runtime, analyticsEvents, seededA, seededB };
}

function signedBody(secret, rawBody, timestamp) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

test('GM-B9 multi-tenant golden chain over real HTTP keeps tenants fully isolated', async (t) => {
  const h = goldenHarness();
  t.after(() => h.server.close());
  const port = await listen(h.server);
  const base = `http://127.0.0.1:${port}`;
  const HA = { 'x-tenant-id': A };
  const HB = { 'x-tenant-id': B };

  // 1) commerce offers are disjoint per tenant
  const offersA = (await (await fetch(`${base}/api/v1/commerce/offers`, { headers: HA })).json()).offers;
  const offersB = (await (await fetch(`${base}/api/v1/commerce/offers`, { headers: HB })).json()).offers;
  assert.equal(offersA.length, 1);
  assert.equal(offersB.length, 1);
  assert.notEqual(offersA[0].offerId ?? offersA[0].providerOfferId, offersB[0].offerId ?? offersB[0].providerOfferId);
  assert.notEqual(offersA[0].effectivePriceMinorUnits, offersB[0].effectivePriceMinorUnits);

  // 2) safe redirect: own tenant resolves, foreign tenant is an indistinguishable 404
  const redirectA = await fetch(`${base}/go/a-drop`, { headers: HA, redirect: 'manual' });
  assert.equal(redirectA.status, 302);
  assert.ok(redirectA.headers.get('location').startsWith('https://'));
  const crossRedirect = await fetch(`${base}/go/b-drop`, { headers: HA, redirect: 'manual' });
  const missingRedirect = await fetch(`${base}/go/missing-drop`, { headers: HB, redirect: 'manual' });
  assert.equal(crossRedirect.status, 404);
  assert.equal(missingRedirect.status, 404);
  assert.equal(await crossRedirect.text(), await missingRedirect.text(), 'cross-tenant and unknown slugs must be indistinguishable');

  // 3) webhook conversion: only the owning tenant can attribute its subId
  const subA = h.seededA.link.subIds.subid;
  const rawBody = JSON.stringify({ orderRef: 'ord-golden-a', revenueMinorUnits: 250000, currency: 'THB', subId: subA });
  const ts = String(Date.now());
  const signature = signedBody('shopee-webhook-secret', rawBody, ts);
  const spoofHeaders = { ...HB, 'content-type': 'application/json', 'x-zaff-signature': signature, 'x-zaff-timestamp': ts, 'x-zaff-event-id': `evt-x-${Date.now()}` };
  const spoofed = await fetch(`${base}/webhooks/shopee`, { method: 'POST', headers: spoofHeaders, body: rawBody });
  assert.equal(spoofed.status, 422, 'foreign tenant must not attribute another tenant subId');
  const legit = await fetch(`${base}/webhooks/shopee`, {
    method: 'POST', headers: { ...HA, 'content-type': 'application/json', 'x-zaff-signature': signature, 'x-zaff-timestamp': ts, 'x-zaff-event-id': 'evt-golden-a-1' },
    body: rawBody
  });
  assert.equal(legit.status, 202);
  assert.equal((await legit.json()).duplicateConversion, false);

  // replays (same tenant and across the tenant boundary) must never double count
  const replaySame = await fetch(`${base}/webhooks/shopee`, {
    method: 'POST', headers: { ...HA, 'content-type': 'application/json', 'x-zaff-signature': signature, 'x-zaff-timestamp': ts, 'x-zaff-event-id': 'evt-golden-a-1' },
    body: rawBody
  });
  assert.equal(replaySame.status, 200);
  assert.equal((await replaySame.json()).duplicate, true);
  await fetch(`${base}/webhooks/shopee`, {
    method: 'POST', headers: { ...HB, 'content-type': 'application/json', 'x-zaff-signature': signature, 'x-zaff-timestamp': ts, 'x-zaff-event-id': 'evt-golden-a-1' },
    body: rawBody
  });
  const conversionsA = h.runtime.drainOutbox(A).filter((e) => e.type === 'conversion.recorded');
  assert.equal(conversionsA.length, 1, 'exactly one conversion effect despite same-tenant replay');
  assert.equal(conversionsA[0]?.payload?.orderRef ?? conversionsA[0]?.orderRef, 'ord-golden-a');
  assert.equal(h.runtime.drainOutbox(B).filter((e) => e.type === 'conversion.recorded').length, 0, 'cross-tenant replay created no conversion anywhere');

  // 4) analytics overview reflects only own-tenant activity
  const overviewA = await (await fetch(`${base}/api/v1/analytics/overview`, { headers: HA })).json();
  const overviewB = await (await fetch(`${base}/api/v1/analytics/overview`, { headers: HB })).json();
  assert.equal(overviewA.clicks, 40, 'tenant A sees exactly its own clicks');
  assert.equal(overviewA.netCommissionMinorUnits, 2000, 'tenant A sees its own commissions');
  assert.equal(overviewB.netCommissionMinorUnits, 2800, 'tenant B sees its own distinct commissions');
  const overviewAAgain = await (await fetch(`${base}/api/v1/analytics/overview`, { headers: HA })).json();
  assert.equal(overviewAAgain.netCommissionMinorUnits, 2000, 'interleaved reads never bleed tenants');

  // 5) automation policy isolation: A tightens, B still on default
  const putPolicy = await fetch(`${base}/api/v1/automation/policy`, {
    method: 'PUT', headers: { ...HA, 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'approval_required', allowedPlatforms: ['tiktok'], maxPostsPerDay: 3, minimumQualityScore: 70, minimumComplianceScore: 70 })
  });
  assert.equal(putPolicy.status, 200);
  const statusA = await (await fetch(`${base}/api/v1/automation/status`, { headers: HA })).json();
  const statusB = await (await fetch(`${base}/api/v1/automation/status`, { headers: HB })).json();
  assert.equal(statusA.mode, 'approval_required');
  assert.notEqual(statusB.mode, 'approval_required', 'tenant B must not inherit tenant A policy');
  assert.deepEqual(statusB.activeKillSwitches, []);

  // 6) intelligence recommendations are tenant-partitioned end to end
  await fetch(`${base}/api/v1/intelligence/opportunities/rank`, { headers: HA });
  await fetch(`${base}/api/v1/intelligence/opportunities/rank`, { headers: HB });
  const recsA = (await (await fetch(`${base}/api/v1/intelligence/recommendations`, { headers: HA })).json()).recommendations;
  const recsB = (await (await fetch(`${base}/api/v1/intelligence/recommendations`, { headers: HB })).json()).recommendations;
  assert.ok(recsA.length > 0 && recsB.length > 0, 'both tenants rank their own catalog');
  const idsA = new Set(recsA.map((r) => r.recommendationId));
  for (const rec of recsB) assert.equal(idsA.has(rec.recommendationId), false, 'recommendation records must never cross tenants');
});
