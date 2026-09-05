import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const here = new URL('.', import.meta.url).pathname;
const releaseCandidate = await import(join(here, '../scripts/release-candidate.mjs'));
const cutover = await import(join(here, '../scripts/cutover.mjs'));

function makeManifestFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'zaff-rc-test-'));
  const manifestPath = join(dir, 'dist', 'release-manifest.json');
  const shaPath = join(dir, 'dist', 'release-manifest.sha256');
  const sbomPath = join(dir, 'dist', 'sbom.json');
  const preflightPath = join(dir, 'dist', 'production-preflight.json');
  return {
    dir,
    paths: { manifestPath, shaPath, sbomPath, preflightPath },
    writeManifest(manifest = { version: '1.0.0', components: ['api', 'web'] }) {
      const body = JSON.stringify(manifest, null, 2);
      const sha = createHash('sha256').update(body).digest('hex');
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, body);
      writeFileSync(shaPath, `${sha}  release-manifest.json\n`);
    },
    writeSbom() {
      mkdirSync(dirname(sbomPath), { recursive: true });
      writeFileSync(sbomPath, JSON.stringify({ components: [] }));
    },
    writePreflight(decision = 'READY_FOR_LIVE_PROVIDER_VERIFICATION', generatedAt = '2026-09-05T00:00:00.000Z') {
      mkdirSync(dirname(preflightPath), { recursive: true });
      writeFileSync(preflightPath, JSON.stringify({
        generatedAt,
        decision,
        checks: [
          { name: 'DATABASE_URL', status: 'PASS' },
          { name: 'OBJECT_STORAGE_WRITE_READ', status: 'PASS' }
        ]
      }));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('runReleaseCandidate: all gates pass with READY_FOR_LIVE_PROVIDER_VERIFICATION', () => {
  const fix = makeManifestFixture();
  try {
    fix.writeManifest();
    fix.writeSbom();
    fix.writePreflight('READY_FOR_LIVE_PROVIDER_VERIFICATION');
    const originalCwd = process.cwd();
    process.chdir(fix.dir);
    try {
      const evidence = releaseCandidate.runReleaseCandidate({
        version: 'test',
        executor: () => true,
        preflight: () => true
      });
      assert.equal(evidence.version, 'test');
      assert.equal(evidence.checksPassed, true);
      assert.equal(evidence.checks.check, true);
      assert.equal(evidence.checks.test, true);
      assert.equal(evidence.checks.releaseManifest, true);
      assert.equal(evidence.checks.sbom, true);
      assert.equal(evidence.checks.preflight.passed, true);
      assert.equal(evidence.checks.preflight.decision, 'READY_FOR_LIVE_PROVIDER_VERIFICATION');
      assert.equal(evidence.checks.manifestSha, true);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    fix.cleanup();
  }
});

test('runReleaseCandidate: BLOCKED preflight decision fails the RC', () => {
  const fix = makeManifestFixture();
  try {
    fix.writeManifest();
    fix.writeSbom();
    fix.writePreflight('BLOCKED');
    const originalCwd = process.cwd();
    process.chdir(fix.dir);
    try {
      const evidence = releaseCandidate.runReleaseCandidate({
        version: 'blocked',
        executor: () => true,
        preflight: () => true
      });
      assert.equal(evidence.checksPassed, false);
      assert.equal(evidence.checks.preflight.passed, false);
      assert.equal(evidence.checks.preflight.decision, 'BLOCKED');
      assert.match(evidence.checks.preflight.reason, /BLOCKED/);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    fix.cleanup();
  }
});

test('runReleaseCandidate: preflight command failure surfaces as reason', () => {
  const fix = makeManifestFixture();
  try {
    fix.writeManifest();
    fix.writeSbom();
    const originalCwd = process.cwd();
    process.chdir(fix.dir);
    try {
      const evidence = releaseCandidate.runReleaseCandidate({
        version: 'fail',
        executor: () => true,
        preflight: () => { throw new Error('boom'); }
      });
      assert.equal(evidence.checks.preflight.passed, false);
      assert.match(evidence.checks.preflight.reason, /preflight command exited non-zero/);
      assert.equal(evidence.checksPassed, false);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    fix.cleanup();
  }
});

test('runReleaseCandidate: preflight evidence missing is fail-closed', () => {
  const fix = makeManifestFixture();
  try {
    fix.writeManifest();
    fix.writeSbom();
    const originalCwd = process.cwd();
    process.chdir(fix.dir);
    try {
      const evidence = releaseCandidate.runReleaseCandidate({
        version: 'missing',
        executor: () => true,
        preflight: () => true
      });
      assert.equal(evidence.checks.preflight.passed, false);
      assert.match(evidence.checks.preflight.reason, /could not read dist\/production-preflight\.json/);
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    fix.cleanup();
  }
});

test('runCutover: dry-run phase returns expected frozen contract', () => {
  const evidence = cutover.runCutover({ phase: 'dry-run' });
  assert.equal(evidence.phase, 'dry-run');
  assert.equal(evidence.rollbackAvailable, false);
  assert.equal(evidence.stopped, false);
  assert.equal(evidence.checks.validRouting, true);
  assert.equal(evidence.checks.legacyDependencyFree, true);
  assert.ok(Object.isFrozen(evidence));
});

test('runCutover: shadow/enable/rollback phases set rollbackAvailable=true', () => {
  for (const phase of ['shadow', 'enable', 'rollback']) {
    const result = cutover.runCutover({ phase });
    assert.equal(result.phase, phase);
    assert.equal(result.rollbackAvailable, true);
    assert.equal(result.stopped, false);
  }
});

test('runCutover: unknown phase throws', () => {
  assert.throws(() => cutover.runCutover({ phase: 'unknown' }), /unsupported phase/);
});

test('runCutover: shadow phase reports countsMatch=true and dualWriteEnabled=true', () => {
  const result = cutover.runCutover({ phase: 'shadow' });
  assert.equal(result.checks.dualWriteEnabled, true);
  assert.equal(result.checks.countsMatch, true);
});
