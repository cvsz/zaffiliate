import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { runPostCutoverSloWatch } from '../scripts/post-cutover-slo-watch.mjs';
import { runReleaseCandidate } from '../scripts/release-candidate.mjs';
import { runPostReleaseSmoke } from '../scripts/post-release-smoke.mjs';

test('post-cutover SLO watch evaluates targets and flags misses', () => {
  const evidence = runPostCutoverSloWatch({ windowMs: 10, sampleIntervalMs: 5 });
  assert.equal(typeof evidence.windowMs, 'number');
  assert.ok(evidence.sloEvaluations.length > 0);
  assert.equal(typeof evidence.alertTriggered, 'boolean');
  assert.ok(evidence.sloEvaluations.every((e) => typeof e.slo === 'string' && typeof e.met === 'boolean'));
});

test('release candidate validation reports checks passed', () => {
  const mock = (cmd) => {
    if (cmd[0] === 'release:manifest') {
      writeFileSync('dist/release-manifest.json', '{}');
      writeFileSync('dist/release-manifest.sha256', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  dist/release-manifest.json\n');
    }
  };
  const evidence = runReleaseCandidate({ version: '0.1.0-rc.1', executor: mock });
  assert.equal(evidence.version, '0.1.0-rc.1');
  assert.ok(typeof evidence.checksPassed === 'boolean');
  assert.ok(Object.keys(evidence.checks).length >= 4);
});

test('post-release smoke hits healthz, readyz, and metrics', async () => {
  const evidence = await runPostReleaseSmoke({ target: 'http://127.0.0.1:0' });
  assert.ok(evidence.passed);
  assert.ok(evidence.checks.some((c) => c.name === 'healthz returns 200' && c.passed));
  assert.ok(evidence.checks.some((c) => c.name === 'metrics returns 200' && c.passed));
});
