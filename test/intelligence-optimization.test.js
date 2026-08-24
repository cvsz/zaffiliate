import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendExperiments, createExplorationPolicy } from '../packages/intelligence/src/optimization.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();

function entry(productId, score, confidence) {
  return { productId, score, confidence, explanation: { reasons: ['fixture'] }, expiresAt: new Date(NOW + 3600000).toISOString() };
}

test('low-confidence candidates become structured experiment proposals', () => {
  const result = recommendExperiments({
    organizationId: 'org-A',
    now: NOW,
    ranked: { ranked: [entry('p-explore', 120, 'LOW'), entry('p-solid', 900, 'HIGH')] },
    minSamplesPerVariant: 50
  });
  assert.equal(result.experiments.length, 1);
  const experiment = result.experiments[0];
  assert.equal(experiment.type, 'CREATE_EXPERIMENT');
  assert.equal(experiment.subjectId, 'p-explore');
  assert.ok(experiment.variants.length >= 2);
  assert.equal(experiment.minSamplesPerVariant, 50);
  assert.match(experiment.hypothesis, /p-explore/i);
  assert.ok(new Date(experiment.expiresAt).getTime() > NOW);
});

test('high-confidence proven winners are left alone — no experiments on settled evidence', () => {
  const result = recommendExperiments({
    organizationId: 'org-A', now: NOW,
    ranked: { ranked: [entry('p-solid', 900, 'HIGH')] }
  });
  assert.equal(result.experiments.length, 0);
});

test('minimum sample floors are enforced below the requested values', () => {
  const result = recommendExperiments({
    organizationId: 'org-A', now: NOW, minSamplesPerVariant: 5,
    ranked: { ranked: [entry('p-x', 10, 'LOW')] }
  });
  assert.equal(result.experiments[0].minSamplesPerVariant, 30, 'statistical floor of 30 applies');
});

test('exploration policy splits slots by a configurable non-hard-coded ratio', () => {
  const policy = createExplorationPolicy({ exploreRatio: 0.25 });
  const allocation = policy.allocate({ totalSlots: 8, entries: [entry('a', 100, 'HIGH'), entry('b', 90, 'LOW'), entry('c', 80, 'LOW')] });
  assert.equal(allocation.exploitSlots, 6);
  assert.equal(allocation.exploreSlots, 2);
  assert.deepEqual(allocation.exploreProductIds.slice().sort(), ['b', 'c']);
});

test('invalid exploration ratios fail closed', () => {
  assert.throws(() => createExplorationPolicy({ exploreRatio: -0.5 }), /between 0 and 1/i);
  assert.throws(() => createExplorationPolicy({ exploreRatio: 1.5 }), /between 0 and 1/i);
});

test('explore slots are filled by TEST-class candidates before anything else', () => {
  const policy = createExplorationPolicy({ exploreRatio: 0.5 });
  const allocation = policy.allocate({
    totalSlots: 2,
    entries: [entry('proven', 500, 'HIGH'), entry('fresh', 10, 'LOW')]
  });
  assert.deepEqual(allocation.exploreProductIds, ['fresh']);
  assert.deepEqual(allocation.exploitProductIds, ['proven']);
});

test('outputs are frozen and carry organization provenance', () => {
  const policy = createExplorationPolicy({});
  const allocation = policy.allocate({ totalSlots: 2, organizationId: 'org-Z', entries: [entry('a', 10, 'LOW')] });
  assert.equal(allocation.organizationId, 'org-Z');
  assert.ok(Object.isFrozen(allocation));
  const result = recommendExperiments({ organizationId: 'org-Z', now: NOW, ranked: { ranked: [entry('a', 10, 'LOW')] } });
  assert.equal(result.organizationId, 'org-Z');
  assert.ok(Object.isFrozen(result));
});

test('empty candidate lists produce empty artifacts', () => {
  const result = recommendExperiments({ organizationId: 'org-A', now: NOW, ranked: { ranked: [] } });
  assert.equal(result.experiments.length, 0);
  const allocation = createExplorationPolicy({}).allocate({ totalSlots: 4, organizationId: 'org-A', entries: [] });
  assert.equal(allocation.exploreSlots, 0);
});
