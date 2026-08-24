import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelRegistry } from '../packages/intelligence/src/registry.js';
import { createShadowComparator } from '../packages/intelligence/src/shadow.js';

const NOW = '2026-08-24T12:00:00.000Z';

function registry() {
  return createModelRegistry({ clock: () => NOW });
}

function registration(overrides = {}) {
  return {
    modelName: 'opportunity-ranker',
    modelVersion: 'baseline-rules-v1',
    task: 'opportunity_ranking',
    trainingDatasetId: 'ds_abc',
    featureSetVersions: { historical_cvr: 1 },
    metrics: { topKHitRate: 0.8 },
    artifactRef: 'ref:ml/artifacts/opportunity-ranker-v1',
    ...overrides
  };
}

test('models register as CANDIDATE with frozen reproducibility metadata', () => {
  const reg = registry();
  const model = reg.register(registration());
  assert.equal(model.status, 'CANDIDATE');
  assert.match(model.registryId, /^mdl_/);
  assert.equal(model.created_at, NOW);
  assert.ok(Object.isFrozen(model));
});

test('duplicate name@version registrations are rejected', () => {
  const reg = registry();
  reg.register(registration());
  assert.throws(() => reg.register(registration()), /already registered/i);
  void 0;
});

function full(reg, overrides = {}, { register: doRegister = true } = {}) {
  if (doRegister) reg.register(registration(overrides));
  reg.transition('opportunity-ranker', overrides.modelVersion ?? 'baseline-rules-v1', 'VALIDATING');
  reg.transition('opportunity-ranker', overrides.modelVersion ?? 'baseline-rules-v1', 'SHADOW');
}

test('candidates can never jump straight to production — promotion requires the full path plus approver', () => {
  const reg = registry();
  reg.register(registration());
  assert.throws(() => reg.transition('opportunity-ranker', 'baseline-rules-v1', 'PRODUCTION'), /must pass through shadow/i);
  full(reg, {}, { register: false });
  assert.throws(() => reg.promote('opportunity-ranker', 'baseline-rules-v1'), /approvedBy is required/i);
  const promoted = reg.promote('opportunity-ranker', 'baseline-rules-v1', { approvedBy: 'sec-review' });
  assert.equal(promoted.status, 'PRODUCTION');
  assert.equal(promoted.approved_by, 'sec-review');
  assert.equal(reg.getProduction('opportunity-ranker').modelVersion, 'baseline-rules-v1');
});

test('promoting a challenger retires the champion while preserving its record for rollback', () => {
  const reg = registry();
  full(reg);
  reg.promote('opportunity-ranker', 'baseline-rules-v1', { approvedBy: 'review-1' });
  full(reg, { modelVersion: 'gradient-boost-v2', artifactRef: 'ref:ml/artifacts/gb-v2' });
  reg.promote('opportunity-ranker', 'gradient-boost-v2', { approvedBy: 'review-2' });

  assert.equal(reg.getProduction('opportunity-ranker').modelVersion, 'gradient-boost-v2');
  const championHistory = reg.get('opportunity-ranker', 'baseline-rules-v1');
  assert.equal(championHistory.status, 'RETIRED');
  assert.ok(championHistory.registryId.startsWith('mdl_'), 'retired records must remain queryable');

  const rolledBack = reg.promote('opportunity-ranker', 'baseline-rules-v1', { approvedBy: 'rollback-op', isRollback: true });
  assert.equal(rolledBack.status, 'PRODUCTION');
  assert.equal(reg.getProduction('opportunity-ranker').modelVersion, 'baseline-rules-v1');
});

test('rejection is terminal and unknown transitions fail closed', () => {
  const reg = registry();
  reg.register(registration());
  reg.reject('opportunity-ranker', 'baseline-rules-v1', { reason: 'metrics below baseline' });
  assert.equal(reg.get('opportunity-ranker', 'baseline-rules-v1').status, 'REJECTED');
  assert.throws(() => reg.transition('opportunity-ranker', 'baseline-rules-v1', 'SHADOW'), /terminal/i);
  assert.throws(() => reg.transition('ghost-model', 'v1', 'VALIDATING'), /not found/i);
});

const NOW_MS = new Date(NOW).getTime();

test('shadow comparator records champion/challenger pairs without side effects', () => {
  const comparator = createShadowComparator({ clock: () => NOW });
  comparator.record({
    tenantId: 'org-A', modelName: 'opportunity-ranker', entityId: 'p1',
    championScore: 100, challengerScore: 100
  });
  comparator.record({
    tenantId: 'org-A', modelName: 'opportunity-ranker', entityId: 'p2',
    championScore: 50, challengerScore: 90
  });
  const report = comparator.compare('org-A', 'opportunity-ranker');
  assert.equal(report.pairs, 2);
  assert.equal(report.agreementRate, 0.5);
  assert.equal(report.meanAbsoluteDelta, 20);
  assert.ok(Object.isFrozen(report));
});

test('empty shadow windows report nulls rather than fake agreement', () => {
  const comparator = createShadowComparator({ clock: () => NOW });
  const report = comparator.compare('org-A', 'opportunity-ranker');
  assert.equal(report.pairs, 0);
  assert.equal(report.agreementRate, null);
  assert.equal(report.meanAbsoluteDelta, null);
});

test('shadow comparisons are tenant-scoped', () => {
  const comparator = createShadowComparator({ clock: () => NOW });
  comparator.record({ tenantId: 'org-A', modelName: 'm', entityId: 'e', championScore: 1, challengerScore: 1 });
  assert.equal(comparator.compare('org-B', 'm').pairs, 0);
});
