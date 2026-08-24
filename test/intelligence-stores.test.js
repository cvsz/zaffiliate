import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrainingDatasetStore, createPredictionStore, createRecommendationStore } from '../packages/intelligence/src/stores.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const HOUR = 3600000;

test('training datasets are frozen, id-stamped and carry reproducibility metadata', () => {
  const datasets = createTrainingDatasetStore({ clock: () => NOW });
  const dataset = datasets.create({
    tenantId: 'org-A',
    labelDefinition: { name: 'converted', source: 'affiliate-core.conversions', windowHours: 168 },
    timeRange: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z' },
    rowCount: 600,
    featureSetVersions: { historical_cvr: 1, discount_ratio: 2 },
    scope: 'ORGANIZATION'
  });
  assert.match(dataset.datasetId, /^ds_/);
  assert.equal(dataset.created_at, new Date(NOW).toISOString());
  assert.equal(dataset.row_count, 600);
  assert.deepEqual(dataset.feature_set_versions, { historical_cvr: 1, discount_ratio: 2 });
  assert.ok(Object.isFrozen(dataset));
  assert.throws(() => { dataset.rowCount = 1; }, TypeError);
});

test('datasets fail closed on missing labels, inverted ranges or negative rows', () => {
  const datasets = createTrainingDatasetStore({ clock: () => NOW });
  const base = { tenantId: 'org-A', timeRange: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z' }, rowCount: 10 };
  assert.throws(() => datasets.create(base), /label definition is required/i);
  assert.throws(() => datasets.create({ ...base, labelDefinition: { name: 'converted' }, timeRange: { from: '2026-08-24T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' } }), /after/i);
  assert.throws(() => datasets.create({ ...base, labelDefinition: { name: 'converted' }, rowCount: -1 }), /non-negative/i);
});

test('prediction store returns latest valid prediction per entity+model and keeps history', () => {
  const letNow = NOW;
  const predictions = createPredictionStore({ clock: () => letNow });
  const save = (validUntil, score) => predictions.save({
    tenantId: 'org-A', model: 'opportunity-ranker', modelVersion: 'baseline-rules-v1',
    entity: { type: 'Product', id: 'p1' }, featuresVersion: { cvr7d: 1 },
    prediction: { score }, confidence: 'MEDIUM',
    validUntil: new Date(validUntil).toISOString()
  });
  const first = save(NOW + HOUR, 100);
  const second = save(NOW + 2 * HOUR, 200);
  assert.match(first.predictionId, /^prd_/);
  const latest = predictions.latest('org-A', 'opportunity-ranker', 'p1');
  assert.equal(latest.prediction.score, 200);

  const later = createPredictionStore({ clock: () => NOW + 3 * HOUR });
  const afterExpiry = later.latest('org-A', 'opportunity-ranker', 'p1');
  assert.equal(afterExpiry, null, 'expired predictions must not serve as current');
  assert.equal(predictions.history('org-A', 'opportunity-ranker', 'p1').length, 2);
});

test('predictions reject unknown confidence tiers and non-positive validity', () => {
  const predictions = createPredictionStore({ clock: () => NOW });
  const base = { tenantId: 'org-A', model: 'm', modelVersion: 'v1', entity: { type: 'Product', id: 'p' }, featuresVersion: {}, prediction: {}, validUntil: new Date(NOW + HOUR).toISOString() };
  assert.throws(() => predictions.save({ ...base, confidence: 'VIBES' }), /unsupported confidence/i);
  assert.throws(() => predictions.save({ ...base, confidence: 'HIGH', validUntil: new Date(NOW - 1).toISOString() }), /must be in the future/i);
});

const RANKED = {
  productId: 'p-strong', score: 420, confidence: 'HIGH',
  explanation: { reasons: ['observed cvr 15.0% over 120 clicks'] },
  expiresAt: new Date(NOW + 4 * HOUR).toISOString(),
  modelVersion: 'baseline-rules-v1'
};

test('recommendations start ACTIVE and record operator feedback with reason', () => {
  const recommendations = createRecommendationStore({ clock: () => NOW });
  const saved = recommendations.save({ tenantId: 'org-A', type: 'PROMOTE_PRODUCT', subjectId: 'p-strong', ...RANKED });
  assert.match(saved.recommendationId, /^rcm_/);
  assert.equal(saved.status, 'ACTIVE');

  const accepted = recommendations.feedback('org-A', saved.recommendationId, { decision: 'ACCEPTED', actorId: 'u1', reason: 'matches growth plan' });
  assert.equal(accepted.status, 'ACCEPTED');
  assert.equal(accepted.feedback.actorId, 'u1');
});

test('expired recommendations can never be accepted — fail closed to EXPIRED', () => {
  let now = NOW;
  const recommendations = createRecommendationStore({ clock: () => now });
  const saved = recommendations.save({ tenantId: 'org-A', type: 'PROMOTE_PRODUCT', subjectId: 'p-x', ...RANKED });
  now = NOW + 5 * HOUR;
  const attempt = recommendations.feedback('org-A', saved.recommendationId, { decision: 'ACCEPTED', actorId: 'u1', reason: 'late approval' });
  assert.equal(attempt.status, 'EXPIRED');
  const rejected = recommendations.feedback('org-A', saved.recommendationId, { decision: 'REJECTED', actorId: 'u1', reason: 'stale anyway' });
  assert.equal(rejected.status, 'REJECTED');
});

test('stores are tenant-isolated across datasets, predictions and recommendations', () => {
  const datasets = createTrainingDatasetStore({ clock: () => NOW });
  datasets.create({ tenantId: 'org-A', labelDefinition: { name: 'converted' }, timeRange: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z' }, rowCount: 1 });
  assert.equal(datasets.list('org-B').length, 0);

  const predictions = createPredictionStore({ clock: () => NOW });
  predictions.save({ tenantId: 'org-A', model: 'm', modelVersion: 'v', entity: { type: 'Product', id: 'x' }, featuresVersion: {}, prediction: {}, confidence: 'LOW', validUntil: new Date(NOW + HOUR).toISOString() });
  assert.equal(predictions.latest('org-B', 'm', 'x'), null);

  const recommendations = createRecommendationStore({ clock: () => NOW });
  const rec = recommendations.save({ tenantId: 'org-A', type: 'WATCH_PRODUCT', subjectId: 'y', ...RANKED });
  assert.throws(() => recommendations.feedback('org-B', rec.recommendationId, { decision: 'ACCEPTED', actorId: 'u' }), /not found/i);
});
