import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

function exec(a, b) {
  if (typeof a === 'function') return a();
  return execFileSync('npm', a, { stdio: 'pipe' });
}

function runCheck(executor) {
  try {
    executor ? executor(['check']) : execFileSync('npm', ['run', 'check'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runTest(executor) {
  try {
    executor ? executor(['test']) : execFileSync('npm', ['test'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runReleaseManifest(executor) {
  try {
    executor ? executor(['release:manifest']) : execFileSync('npm', ['run', 'release:manifest'], { stdio: 'pipe' });
    return existsSync('dist/release-manifest.json') && existsSync('dist/release-manifest.sha256');
  } catch {
    return false;
  }
}

function runSbom(executor) {
  try {
    executor ? executor(['sbom']) : execFileSync('node', ['scripts/generate-sbom.mjs'], { stdio: 'pipe' });
    return existsSync('dist/sbom.json');
  } catch {
    return false;
  }
}

function verifyManifestSha() {
  try {
    const expected = readFileSync('dist/release-manifest.sha256', 'utf8').trim().split(/\s+/)[0];
    const actual = createHash('sha256').update(readFileSync('dist/release-manifest.json', 'utf8')).digest('hex');
    return expected === actual;
  } catch {
    return false;
  }
}

export function runReleaseCandidate({ version, executor } = {}) {
  const checks = {
    check: runCheck(executor),
    test: runTest(executor),
    releaseManifest: runReleaseManifest(executor),
    sbom: runSbom(executor),
    manifestSha: verifyManifestSha()
  };
  const checksPassed = Object.values(checks).every((v) => v === true);
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync('dist/release-manifest.json', 'utf8'));
  } catch {
    // ignore
  }
  const evidence = Object.freeze({ version: version || 'rc', checks, checksPassed, manifest });
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/rc-evidence.json', JSON.stringify(evidence, null, 2));
  return evidence;
}
