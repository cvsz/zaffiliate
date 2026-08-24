import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRegistry } from '../packages/intelligence/src/registry.js';
import { classifyPortfolio } from '../packages/intelligence/src/portfolio.js';

const NOW = '2026-08-24T12:00:00.000Z';

function registry() {
  return createModelRegistry({ clock: () => NOW });
}

function full(reg, modelVersion = 'baseline-rules-v1', overrides = {}) {
  reg.register({
    modelName: 'opportunity-ranker', modelVersion, task: 'opportunity_ranking',
    trainingDatasetId: 'ds_1', featureSetVersions: { f: 1 }, metrics: { hitRate: 0.8 },
    artifactRef: `ref:ml/${modelVersion}`, ...overrides
  });
  reg.transition('opportunity-ranker', modelVersion, 'VALIDATING');
  reg.transition('opportunity-ranker', modelVersion, 'SHADOW');
}

test('rollback promotes a retired version and appends an audited event', () => {
  const audits = [];
  const reg = registry();
  full(reg);
  reg.promote('opportunity-ranker', 'baseline-rules-v1', { approvedBy: 'review-1' });
  full(reg, 'challenger-v2');
  reg.promote('opportunity-ranker', 'challenger-v2', { approvedBy: 'review-2' });
  assert.equal(reg.getProduction('opportunity-ranker').modelVersion, 'challenger-v2');

  const rolledBack = reg.rollbackModel('opportunity-ranker', {
    toVersion: 'baseline-rules-v1',
    actorId: 'sec-op',
    reason: 'challenger caused publishing regression',
    auditSink: (event) => audits.push(event)
  });

  assert.equal(rolledBack.status, 'PRODUCTION');
  assert.equal(reg.getProduction('opportunity-ranker').modelVersion, 'baseline-rules-v1');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'model.rollback');
  assert.equal(audits[0].actor, 'sec-op');
  assert.match(audits[0].detail.reason, /regression/);
});

test('rollback refuses versions that were never registered or are already in production', () => {
  const reg = registry();
  full(reg);
  reg.promote('opportunity-ranker', 'baseline-rules-v1', { approvedBy: 'r1' });
  assert.throws(() => reg.rollbackModel('opportunity-ranker', { toVersion: 'ghost-v9', actorId: 'x', reason: 'y' }), /not found/i);
  assert.throws(() => reg.rollbackModel('opportunity-ranker', { toVersion: 'baseline-rules-v1', actorId: 'x', reason: 'already live' }), /already the active production/i);
});

function entry(productId, score, confidence) {
  return { productId, score, confidence, explanation: { reasons: ['fixture'] }, expiresAt: new Date(new Date(NOW).getTime() + 3600000).toISOString() };
}

test('zero-score candidates are paused with explicit reasons', () => {
  const portfolio = classifyPortfolio({
    now: NOW,
    ranked: { ranked: [entry('p-dead', 0, 'LOW'), entry('p-live', 500, 'HIGH')] }
  });
  const paused = portfolio.entries.find((item) => item.productId === 'p-dead');
  assert.equal(paused.classification, 'PAUSE');
  assert.match(paused.reason, /not promotable/i);
  assert.equal(portfolio.entries.find((item) => item.productId === 'p-live').classification, 'SCALE');
});

test('low-confidence candidates route to TEST instead of autonomous scaling', () => {
  const portfolio = classifyPortfolio({
    now: NOW,
    ranked: { ranked: [entry('p-mid', 300, 'LOW'), entry('p-top', 900, 'HIGH')] }
  });
  const tested = portfolio.entries.find((item) => item.productId === 'p-mid');
  assert.equal(tested.classification, 'TEST');
  assert.match(tested.reason, /exploratory/i);
});

test('drift alerts cap automation eligibility at WATCH', () => {
  const portfolio = classifyPortfolio({
    now: NOW,
    ranked: { ranked: [entry('p-top', 900, 'HIGH')] },
    driftByProduct: { 'p-top': { severity: 'ALERT' } }
  });
  const item = portfolio.entries[0];
  assert.equal(item.classification, 'WATCH');
  assert.match(item.reason, /drift/i);
});

test('portfolio output is deterministic, frozen and empty-safe', () => {
  const input = { ranked: { ranked: [entry('b', 10, 'LOW'), entry('a', 20, 'MEDIUM')] } };
  const first = classifyPortfolio({ now: NOW, ranked: input.ranked });
  const second = classifyPortfolio({ now: NOW, ranked: input.ranked });
  assert.deepEqual(first.entries.map((e) => [e.productId, e.classification]), second.entries.map((e) => [e.productId, e.classification]));
  assert.ok(Object.isFrozen(first));
  const empty = classifyPortfolio({ now: NOW, ranked: { ranked: [] } });
  assert.equal(empty.entries.length, 0);
});
