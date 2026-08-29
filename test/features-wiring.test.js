import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../apps/api/src/server.js';
import { createCommerceStore } from '../packages/affiliate-core/src/commerce.js';
import { createEventStore } from '../packages/analytics/src/events.js';
import {
  createFeatureStore,
  defineBaselineRanker,
} from '../packages/intelligence/src/index.js';
import { createRecommendationStore } from '../packages/intelligence/src/stores.js';
import envelopeFactory from './fixtures/envelope-helper.js';

const TENANT = { 'x-tenant-id': 'org-A' };

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function harness() {
  const clock = () => new Date('2026-08-24T12:00:00.000Z').getTime();
  const commerceStore = createCommerceStore({ clock });
  const analyticsEvents = createEventStore();
  const featureStore = createFeatureStore({ clock });
  const recommendationStore = createRecommendationStore({ clock });
  const ranker = defineBaselineRanker({ featureStore });

  const product = { productId: 'prod_1', platform: 'tiktok', externalProductId: 'x', title: 'Gadget' };
  void product;
  const offer = commerceStore.upsertOffer('org-A', {
    provider: 'tiktok', providerOfferId: 'prov-1', merchantId: 'm1', productId: 'prod_1',
    currency: 'THB', listPriceMinorUnits: 100000, salePriceMinorUnits: 80000,
    inventoryStatus: 'IN_STOCK', source: 'sync', commissionRate: 0.12, verifiedAt: new Date(clock()).toISOString()
  });
  for (let i = 0; i < 120; i += 1) {
    analyticsEvents.ingest(envelopeFactory(clock, `c${i}`, 'prod_1'));
  }
  return { commerceStore, analyticsEvents, featureStore, recommendationStore, ranker, offer };
}

test('commerce offers surface through the wired API', async (t) => {
  const h = harness();
  const server = buildServer({ env: { APP_ENV: 'development' }, ...h });
  t.after(() => server.close());
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/commerce/offers`, { headers: TENANT });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.offers.length, 1);
  assert.equal(body.offers[0].effectivePriceMinorUnits, 80000);
});

test('intelligence ranking endpoint produces scored recommendations', async (t) => {
  const h = harness();
  const server = buildServer({ env: { APP_ENV: 'development' }, ...h });
  t.after(() => server.close());
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/opportunities/rank`, { headers: TENANT });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.modelVersion, 'baseline-rules-v1');
  assert.ok(Array.isArray(body.ranked));
});

test('recommendation feedback records operator decisions', async (t) => {
  const h = harness();
  const server = buildServer({ env: { APP_ENV: 'development' }, ...h });
  t.after(() => server.close());
  const port = await listen(server);
  const ranked = await (await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/opportunities/rank`, { headers: TENANT })).json();
  void ranked;
  const recs = await (await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/recommendations`, { headers: TENANT })).json();
  assert.ok(recs.recommendations.length > 0, 'rank-and-record must persist recommendations');
  const id = recs.recommendations[0].recommendationId;
  const fb = await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/recommendations/${id}/feedback`, {
    method: 'POST', headers: { ...TENANT, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'ACCEPTED', actorId: 'u1', reason: 'wired' })
  });
  assert.equal(fb.status, 200);
  assert.equal((await fb.json()).status, 'ACCEPTED');
});

test('analytics overview aggregates the deduplicated event stream', async (t) => {
  const h = harness();
  const server = buildServer({ env: { APP_ENV: 'development' }, ...h });
  t.after(() => server.close());
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/analytics/overview`, { headers: TENANT });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok('netCommissionMinorUnits' in body);
});

test('all feature routes are tenant-gated', async (t) => {
  const h = harness();
  const server = buildServer({ env: { APP_ENV: 'development' }, ...h });
  t.after(() => server.close());
  const port = await listen(server);
  for (const p of ['/api/v1/commerce/offers', '/api/v1/analytics/overview', '/api/v1/intelligence/opportunities/rank']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`);
    assert.equal(r.status, 400, `${p} must require tenant header`);
  }
});
