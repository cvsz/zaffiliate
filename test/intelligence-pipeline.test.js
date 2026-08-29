import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceStore } from '../packages/affiliate-core/src/commerce.js';
import { createEventStore, buildEventEnvelope } from '../packages/analytics/src/events.js';
import { createFeatureStore, defineBaselineRanker } from '../packages/intelligence/src/index.js';
import { createRecommendationStore, createPredictionStore } from '../packages/intelligence/src/stores.js';
import { computeOfferFeatures, createRecommendationService } from '../packages/intelligence/src/pipeline.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const TENANT = 'org-A';
const FRESH = new Date(NOW - 5 * 60 * 1000).toISOString();

function harness() {
  const clock = () => NOW;
  const commerce = createCommerceStore({ clock });
  const analytics = createEventStore();
  const features = createFeatureStore({ clock });
  const recommendations = createRecommendationStore({ clock });
  const predictions = createPredictionStore({ clock });
  const ranker = defineBaselineRanker({ featureStore: features });

  const product = { productId: 'prod_1', platform: 'tiktok', externalProductId: 'x', title: 'Gadget', currency: 'THB' };
  const registered = commerce.upsertOffer === undefined ? null : null;
  void registered;
  return { commerce, analytics, features, recommendations, predictions, ranker, product };
}

function seedOffer(commerce, overrides = {}) {
  return commerce.upsertOffer(TENANT, {
    provider: 'tiktok', providerOfferId: 'prov-1', merchantId: 'm1', productId: 'prod_1',
    currency: 'THB', listPriceMinorUnits: 100000, salePriceMinorUnits: 80000,
    inventoryStatus: 'IN_STOCK', source: 'catalog-sync', verifiedAt: FRESH,
    ...overrides
  });
}

test('offer features are computed from verified snapshots with correct types', () => {
  const { commerce, analytics, features } = harness();
  const offer = seedOffer(commerce);
  commerce.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 80000, observedAt: FRESH, source: 'sync' });

  const result = computeOfferFeatures({ commerceStore: commerce, analyticsEvents: analytics, featureStore: features, tenantId: TENANT, offerIds: [offer.offerId] });
  assert.equal(result.computed.length, 1);

  const discount = features.getValue(TENANT, 'offer_discount_ratio', offer.offerId);
  assert.equal(discount.value, 0.2);
  assert.equal(discount.freshnessStatus, 'FRESH');
  const inventory = features.getValue(TENANT, 'offer_inventory', offer.offerId);
  assert.equal(inventory.value, 'IN_STOCK');
});

test('stale commercial evidence produces STALE features instead of fresh lies', () => {
  const { commerce, analytics, features } = harness();
  const offer = seedOffer(commerce, { verifiedAt: new Date(NOW - 6 * 60 * 60 * 1000).toISOString() });
  computeOfferFeatures({ commerceStore: commerce, analyticsEvents: analytics, featureStore: features, tenantId: TENANT, offerIds: [offer.offerId] });
  const discount = features.getValue(TENANT, 'offer_discount_ratio', offer.offerId);
  assert.equal(discount.freshnessStatus, 'STALE');
});

function feedClicksConversions(analytics, productId, clicks, conversions) {
  let seq = 0;
  for (let i = 0; i < clicks; i += 1) {
    const envInput = buildEvent('affiliate_click_recorded', 'FIRST_PARTY', { affiliateLinkId: 'lnk', lineageProductId: productId }, `c-${productId}-${++seq}`);
    if (i === 0) process.stderr.write(`[env] ${JSON.stringify({ t: envInput.type, pid: envInput.productId, link: envInput.affiliateLinkId, org: envInput.organizationId })}\n`);
    analytics.ingest(envInput);
  }
  for (let i = 0; i < conversions; i += 1) {
    analytics.ingest(buildEvent('commission_reported', 'AFFILIATE_PROVIDER_REPORTED', { status: 'approved', amountMinorUnits: 500, currency: 'USD', lineageProductId: productId }, `k-${productId}-${++seq}`));
  }
}

function buildEvent(type, sourceType, { lineageProductId, affiliateLinkId, ...payload }, externalEventId) {
  return buildEventEnvelope({
    organizationId: TENANT, provider: 'tiktok', type, sourceType,
    occurredAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    externalEventId, productId: lineageProductId,
    affiliateLinkId: type === 'affiliate_click_recorded' ? affiliateLinkId : undefined,
    payload
  });
}

test('per-product engagement features derive from the deduplicated event stream', () => {
  const { commerce, analytics, features } = harness();
  const offer = seedOffer(commerce);
  for (let k = 0; k < 40; k += 1) {
    analytics.ingest(buildEvent('affiliate_click_recorded', 'FIRST_PARTY', { affiliateLinkId: 'lnk', lineageProductId: 'prod_1' }, `c-${k}`));
  }
  for (let k = 0; k < 8; k += 1) {
    analytics.ingest(buildEvent('commission_reported', 'AFFILIATE_PROVIDER_REPORTED', { status: 'approved', amountMinorUnits: 500, currency: 'USD', lineageProductId: 'prod_1' }, `k-${k}`));
  }

  computeOfferFeatures({ commerceStore: commerce, analyticsEvents: analytics, featureStore: features, tenantId: TENANT, offerIds: [offer.offerId] });

  assert.equal(features.getValue(TENANT, 'product_clicks_7d', 'prod_1').value, 40);
  assert.equal(features.getValue(TENANT, 'product_cvr_7d', 'prod_1').value, 0.2);
});

test('rank-and-record persists auditable recommendations and the top prediction', () => {
  const { commerce, analytics, features, recommendations, predictions, ranker } = harness();
  const offer = seedOffer(commerce);
  commerce.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 80000, observedAt: FRESH, source: 'sync' });
  feedClicksConversions(analytics, 'prod_1', 120, 18);

  computeOfferFeatures({ commerceStore: commerce, analyticsEvents: analytics, featureStore: features, tenantId: TENANT, offerIds: [offer.offerId] });
  const service = createRecommendationService({ featureStore: features, recommendationStore: recommendations, predictionStore: predictions, ranker });
  const outcome = service.rankAndRecord({
    tenantId: TENANT, now: NOW,
    candidates: [{ productId: 'prod_1', offer: offerFrom(commerce, offer), metrics: metricsFor(analytics, 'prod_1') }]
  });

  assert.equal(outcome.recommendations.length, 1);
  const stored = recommendations.save;
  void stored;
  const all = listRecommendations(recommendations, TENANT);
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'ACTIVE');
  assert.equal(all[0].modelVersion, 'baseline-rules-v1');
  assert.equal(outcome.topPrediction.prediction.productId, 'prod_1');
  assert.ok(outcome.topPrediction.confidence === 'HIGH' || outcome.topPrediction.confidence === 'MEDIUM');
});

function offerFrom(commerce, offer) {
  const current = commerce.getOffer(TENANT, offer.offerId);
  return {
    priceMinorUnits: current.salePriceMinorUnits ?? current.effectivePriceMinorUnits,
    listPriceMinorUnits: current.listPriceMinorUnits,
    commissionRate: current.commissionRate ?? 0.05,
    inventoryStatus: current.inventoryStatus
  };
}

function metricsFor(analytics, productId) {
  const perProduct = analytics.summarizeByProduct(TENANT).get(productId) ?? { clicks: 0, conversions: 0 };
  return { clicks: perProduct.clicks, conversions: perProduct.conversions, netCommissionMinorUnits: perProduct.netCommissionMinorUnits, refundsMinorUnits: 0 };
}

function listRecommendations(store, tenantId) {
  return store.list(tenantId);
}

test('recommendations remain tenant-isolated end-to-end', () => {
  const { commerce, analytics, features, recommendations, predictions, ranker } = harness();
  const offer = seedOffer(commerce);
  computeOfferFeatures({ commerceStore: commerce, analyticsEvents: analytics, featureStore: features, tenantId: TENANT, offerIds: [offer.offerId] });
  const service = createRecommendationService({ featureStore: features, recommendationStore: recommendations, predictionStore: predictions, ranker });
  service.rankAndRecord({
    tenantId: TENANT, now: NOW,
    candidates: [{ productId: 'prod_1', offer: offerFrom(commerce, offer), metrics: metricsFor(analytics, 'prod_1') }]
  });
  assert.equal(listRecommendations(recommendations, 'org-B').length, 0);
  assert.equal(predictions.latest('org-B', 'baseline-rules-v1', 'prod_1'), null);
});
