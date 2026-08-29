import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureStore, defineBaselineRanker } from '../packages/intelligence/src/index.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const HOUR = 3600000;

function store(overrides = {}) {
  return createFeatureStore({ clock: () => NOW, ...overrides });
}

test('feature definitions are versioned and immutable in the registry', () => {
  const fs = store();
  fs.defineFeature({ name: 'historical_cvr', entityType: 'Product', valueType: 'number', version: 1, source: 'analytics-events', freshnessWindowMs: 24 * HOUR });
  assert.throws(() => fs.defineFeature({ name: 'historical_cvr', entityType: 'Product', valueType: 'number', version: 1 }), /already defined/i);
  const def = fs.getDefinition('historical_cvr', 1);
  assert.equal(def.owner, 'intelligence');
  assert.ok(Object.isFrozen(def));
  assert.equal(fs.getDefinition('historical_cvr', 2), null);
});

test('feature definitions reject malformed shapes', () => {
  const fs = store();
  assert.throws(() => fs.defineFeature({ name: '', entityType: 'Product', valueType: 'number' }), /name is required/i);
  assert.throws(() => fs.defineFeature({ name: 'x', entityType: 'Widget', valueType: 'number' }), /unsupported entity type/i);
  assert.throws(() => fs.defineFeature({ name: 'x', entityType: 'Product', valueType: 'tensor' }), /unsupported value type/i);
});

test('values enforce their declared value type and carry computed timestamps', () => {
  const fs = store();
  fs.defineFeature({ name: 'price_minor', entityType: 'Offer', valueType: 'number', freshnessWindowMs: HOUR });
  fs.setValue('org-A', 'price_minor', { entityId: 'off_1', value: 80000 });
  assert.throws(() => fs.setValue('org-A', 'price_minor', { entityId: 'off_1', value: 'cheap' }), /expects number/i);
  const read = fs.getValue('org-A', 'price_minor', 'off_1');
  assert.equal(read.value, 80000);
  assert.equal(read.freshnessStatus, 'FRESH');
});

test('freshness transitions FRESH -> AGING -> STALE against the definition window', () => {
  let now = NOW;
  const fs = createFeatureStore({ clock: () => now });
  fs.defineFeature({ name: 'cvr7d', entityType: 'Product', valueType: 'number', freshnessWindowMs: 10 * HOUR });
  fs.setValue('org-A', 'cvr7d', { entityId: 'p1', value: 0.05 });

  now = NOW + 3 * HOUR;
  assert.equal(fs.getValue('org-A', 'cvr7d', 'p1').freshnessStatus, 'FRESH');
  now = NOW + 7 * HOUR;
  assert.equal(fs.getValue('org-A', 'cvr7d', 'p1').freshnessStatus, 'AGING');
  now = NOW + 11 * HOUR;
  const stale = fs.getValue('org-A', 'cvr7d', 'p1');
  assert.equal(stale.freshnessStatus, 'STALE');
  assert.throws(() => { stale.value = 1; }, TypeError);
});

test('missing features report UNKNOWN rather than fabricating values', () => {
  const fs = store();
  fs.defineFeature({ name: 'trend_score', entityType: 'Product', valueType: 'number', freshnessWindowMs: HOUR });
  const missing = fs.getValue('org-A', 'trend_score', 'never-set');
  assert.equal(missing.freshnessStatus, 'UNKNOWN');
  assert.equal(missing.value, null);
});

test('features are tenant-partitioned with no cross-tenant reads', () => {
  const fs = store();
  fs.defineFeature({ name: 'epc', entityType: 'Product', valueType: 'number', freshnessWindowMs: 24 * HOUR });
  fs.setValue('org-A', 'epc', { entityId: 'p1', value: 75 });
  assert.equal(fs.getValue('org-B', 'epc', 'p1').value, null);
  assert.equal(fs.getValue('org-B', 'epc', 'p1').freshnessStatus, 'UNKNOWN');
});

function DAY() {}

test('baseline ranker orders candidates by evidence-backed expected value', () => {
  const fs = store();
  const ranker = defineBaselineRanker({ featureStore: fs });
  const ranked = ranker.rank({
    tenantId: 'org-A',
    now: NOW,
    candidates: [
      strongCandidate('p-strong'),
      weakCandidate('p-weak')
    ]
  });
  assert.equal(ranked.modelVersion, 'baseline-rules-v1');
  assert.equal(ranked.ranked[0].productId, 'p-strong');
  assert.ok(ranked.ranked[0].score > ranked.ranked[1].score);
  assert.ok(ranked.ranked[0].confidence === 'HIGH' || ranked.ranked[0].confidence === 'MEDIUM');
  for (const rec of ranked.ranked) {
    assert.ok(rec.explanation.reasons.length > 0);
    assert.match(rec.explanation.reasons[0], /cvr|discount|inventory|sample/i);
    assert.ok(rec.expiresAt > ranked.generatedAt);
  }
});

function strongCandidate(productId) {
  return {
    productId,
    offer: { priceMinorUnits: 80000, listPriceMinorUnits: 100000, commissionRate: 0.12, inventoryStatus: 'IN_STOCK', promotionEndsAt: new Date(NOW + 4 * 24 * HOUR).toISOString() },
    metrics: { clicks: 120, conversions: 18, netCommissionMinorUnits: 90000, refundsMinorUnits: 6000 }
  };
}

function weakCandidate(productId) {
  return {
    productId,
    offer: { priceMinorUnits: 99000, listPriceMinorUnits: 100000, commissionRate: 0.03, inventoryStatus: 'LOW_STOCK', promotionEndsAt: new Date(NOW - HOUR).toISOString() },
    metrics: { clicks: 12, conversions: 0, netCommissionMinorUnits: 500, refundsMinorUnits: 400 }
  };
}

test('out-of-stock and unknown inventory sink to the bottom with explicit reasons', () => {
  const ranker = defineBaselineRanker({ featureStore: store() });
  const ranked = ranker.rank({
    tenantId: 'org-A',
    now: NOW,
    candidates: [
      strongCandidate('p-ok'),
      { ...strongCandidate('p-gone'), offer: { ...strongCandidate('p-gone').offer, inventoryStatus: 'OUT_OF_STOCK' } },
      { ...strongCandidate('p-mystery'), offer: { ...strongCandidate('p-mystery').offer, inventoryStatus: 'UNKNOWN' } }
    ]
  });
  assert.deepEqual(ranked.ranked.map((rec) => rec.productId), ['p-ok', 'p-gone', 'p-mystery']);
  assert.match(ranked.ranked[1].explanation.reasons.join(' '), /inventory/i);
  assert.equal(ranked.ranked[2].score, 0);
});

test('expired promotions are flagged inside the explanation and reduce score', () => {
  const ranker = defineBaselineRanker({ featureStore: store() });
  const ranked = ranker.rank({
    tenantId: 'org-A',
    now: NOW,
    candidates: [weakCandidate('p-expired')]
  });
  assert.match(ranked.ranked[0].explanation.reasons.join(' '), /promotion expired/i);
});

test('rankings are tenant-scoped and deterministic', () => {
  const ranker = defineBaselineRanker({ featureStore: store() });
  const input = { candidates: [strongCandidate('p1'), weakCandidate('p2')] };
  const a = ranker.rank({ tenantId: 'org-A', now: NOW, candidates: input.candidates.map((c) => ({ ...c })) });
  const b = ranker.rank({ tenantId: 'org-B', now: NOW, candidates: input.candidates.map((c) => ({ ...c })) });
  assert.deepEqual(a.ranked.map((r) => r.productId), b.ranked.map((r) => r.productId));
  assert.equal(a.tenantId, 'org-A');
  assert.equal(b.tenantId, 'org-B');
});
