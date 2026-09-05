import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

function runPreflight(executor) {
  try {
    executor ? executor(['preflight:production']) : execFileSync('npm', ['run', 'preflight:production'], { stdio: 'pipe' });
  } catch {
    return { passed: false, decision: null, reason: 'preflight command exited non-zero' };
  }
  try {
    const evidence = JSON.parse(readFileSync('dist/production-preflight.json', 'utf8'));
    if (evidence.decision !== 'READY_FOR_LIVE_PROVIDER_VERIFICATION') {
      const blocked = (evidence.checks || [])
        .filter((c) => ['BLOCKED', 'FAIL'].includes(c.status))
        .map((c) => `${c.name}=${c.status}`)
        .join(',');
      return { passed: false, decision: evidence.decision, reason: `preflight decision=${evidence.decision}; blocked: ${blocked || '(none)'}` };
    }
    return { passed: true, decision: evidence.decision, generatedAt: evidence.generatedAt };
  } catch (error) {
    return { passed: false, decision: null, reason: `could not read dist/production-preflight.json: ${String(error?.message ?? error)}` };
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

export function runReleaseCandidate({ version, executor, preflight } = {}) {
  const preflightResult = runPreflight(preflight ?? executor);
  const checks = {
    check: runCheck(executor),
    test: runTest(executor),
    releaseManifest: runReleaseManifest(executor),
    sbom: runSbom(executor),
    preflight: preflightResult,
    manifestSha: verifyManifestSha()
  };
  const checksPassed = Object.entries(checks).every(([key, value]) => {
    if (key === 'preflight') return value?.passed === true;
    return value === true;
  });
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
