import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRanking } from '../packages/intelligence/src/evaluation.js';
import { explainRecommendation } from '../packages/intelligence/src/evaluation.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').toISOString();
const HOUR_MS = 3600000;

function ranked(order, scores) {
  return {
    modelVersion: 'baseline-rules-v1',
    generatedAt: NOW,
    ranked: order.map((productId, index) => ({
      productId,
      score: scores ? scores[index] : order.length - index,
      confidence: 'MEDIUM',
      explanation: { reasons: ['fixture'] },
      expiresAt: new Date(new Date(NOW).getTime() + 3600000).toISOString()
    }))
  };
}

test('perfect ranking yields a top-k hit rate of 1', () => {
  const report = evaluateRanking({
    ranked: ranked(['p-good-1', 'p-good-2', 'p-bad']),
    groundTruth: {
      knownGood: ['p-good-1', 'p-good-2'],
      outcomeByProduct: { 'p-good-1': 500, 'p-good-2': 400, 'p-bad': 10 }
    },
    now: NOW
  });
  assert.equal(report.topKHitRate, 1);
  assert.equal(report.sampleSize, 3);
  assert.ok(Object.isFrozen(report));
});

test('inverted ranking yields a hit rate of 0 and negative score-outcome correlation', () => {
  const report = evaluateRanking({
    ranked: ranked(['p-bad', 'p-good-1', 'p-good-2']),
    groundTruth: {
      knownGood: ['p-good-1', 'p-good-2'],
      outcomeByProduct: { 'p-good-2': 500, 'p-good-1': 400, 'p-bad': 10 }
    },
    now: NOW
  });
  const k = Math.min(2, report.k);
  assert.equal(report.topKHitRate, 0);
  assert.ok(report.scoreOutcomeCorrelation < 0);
  void k;
});

test('correlation tracks monotonic agreement between score and realized outcome', () => {
  const report = evaluateRanking({
    ranked: ranked(['a', 'b', 'c'], [90, 50, 10]),
    groundTruth: { knownGood: ['a', 'b', 'c'], outcomeByProduct: { a: 900, b: 500, c: 100 } },
    now: NOW
  });
  assert.ok(report.scoreOutcomeCorrelation > 0.99);
});

test('fewer than two paired observations report null correlation instead of pretending', () => {
  const report = evaluateRanking({
    ranked: ranked(['a']),
    groundTruth: { knownGood: ['a'], outcomeByProduct: { a: 100 } },
    now: NOW
  });
  assert.equal(report.scoreOutcomeCorrelation, null);
});

test('k is clamped to the ranked list length', () => {
  const report = evaluateRanking({
    ranked: ranked(['a']),
    groundTruth: { knownGood: ['a'], outcomeByProduct: { a: 100 } },
    now: NOW,
    k: 10
  });
  assert.equal(report.k, 1);
});

test('missing outcomes exclude products from evaluation but never fabricate hits', () => {
  const report = evaluateRanking({
    ranked: ranked(['a', 'b']),
    groundTruth: { knownGood: ['a'], outcomeByProduct: {} },
    now: NOW
  });
  assert.equal(report.sampleSize, 0);
  assert.equal(report.topKHitRate, 0);
});

const RECORD = Object.freeze({
  recommendationId: 'rcm_x',
  type: 'PROMOTE_PRODUCT',
  subjectId: 'prod_1',
  score: 420,
  confidence: 'HIGH',
  modelVersion: 'baseline-rules-v1',
  status: 'ACTIVE',
  explanation: { reasons: ['observed cvr 15.0% over 120 clicks', 'promotion active for 96h more'] },
  expiresAt: new Date(new Date(NOW).getTime() + 4 * 3600000).toISOString(),
  feedback: null
});

test('explanation layer renders evidence, confidence, freshness and model version', () => {
  const explained = explainRecommendation(RECORD, { featureFreshness: { product_cvr_7d: 'FRESH' }, now: NOW });
  assert.equal(explained.recommendationId, 'rcm_x');
  assert.equal(explained.summary.type, 'PROMOTE_PRODUCT');
  assert.equal(explained.confidence, 'HIGH');
  assert.equal(explained.modelVersion, 'baseline-rules-v1');
  assert.deepEqual(explained.dataFreshness, { product_cvr_7d: 'FRESH' });
  assert.ok(explained.reasons.includes('observed cvr 15.0% over 120 clicks'));
  assert.match(explained.summary.text, /PROMOTE_PRODUCT.*prod_1/);
  assert.ok(Object.isFrozen(explained));
});

test('expired recommendations are labeled as such in the explanation', () => {
  const expiredRecord = { ...RECORD, expiresAt: new Date(new Date(NOW).getTime() - HOUR_MS).toISOString(), status: 'ACTIVE' };
  const explained = explainRecommendation(expiredRecord, { now: NOW });
  assert.equal(explained.executable, false);
  assert.match(explained.summary.text, /EXPIRED/i);
});
