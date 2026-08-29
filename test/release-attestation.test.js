import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptBase = join(repoRoot, 'scripts');

test('gpg-attest.mjs exports buildEvidence returning frozen contract', async () => {
  const savedExitCode = process.exitCode;
  const mod = await import(join(scriptBase, 'gpg-attest.mjs'));
  process.exitCode = savedExitCode;
  const evidence = mod.buildEvidence({
    keyId: '0xDEADBEEF',
    commitSha: 'abc123',
    verified: true,
    pushed: false
  });
  assert.ok(Object.isFrozen(evidence));
  assert.deepEqual(evidence, { keyId: '0xDEADBEEF', commitSha: 'abc123', verified: true, pushed: false });
});

test('generate-sbom.mjs exports buildSbom returning frozen contract with deterministic key ordering', async () => {
  const mod = await import(join(scriptBase, 'generate-sbom.mjs'));
  const sbom = mod.buildSbom({
    components: [
      { type: 'application', name: 'zaffiliate', version: '1.0.0', purl: 'pkg:npm/zaffiliate@1.0.0' },
      { type: 'application', name: 'cvsz/zaffiliate', version: 'abc123', purl: 'pkg:github/cvsz/zaffiliate@abc123' }
    ],
    artifacts: [
      { path: 'apps/api/src/server.js', hashes: [{ alg: 'SHA-256', content: 'a' }], mimeType: 'application/javascript' },
      { path: 'apps/web/server.js', hashes: [{ alg: 'SHA-256', content: 'b' }], mimeType: 'application/javascript' }
    ],
    metadata: { timestamp: '2026-08-22T11:00:00.000Z', tools: [{ name: 'test', version: '1.0.0' }] }
  });
  assert.ok(Object.isFrozen(sbom));
  assert.ok(Object.isFrozen(sbom.metadata));
  assert.ok(Object.isFrozen(sbom.components));
  assert.ok(Object.isFrozen(sbom.artifacts));
  const keys = Object.keys(sbom);
  assert.deepEqual(keys, ['artifacts', 'components', 'metadata', 'specVersion', 'version']);
});

test('release.yml is a valid workflow file with required keys', async () => {
  const workflowPath = join(repoRoot, '.github', 'workflows', 'release.yml');
  const content = await readFile(workflowPath, 'utf8');
  assert.ok(content.includes('name: Release'));
  assert.ok(content.includes("on:\n  push:\n    tags:\n      - 'v*'"));
  assert.ok(content.includes('uses: actions/checkout@v7'));
  assert.ok(content.includes('uses: actions/setup-node@v7'));
  assert.ok(content.includes('uses: actions/upload-artifact@v7'));
  assert.ok(content.includes('uses: docker/build-push-action@v5'));
  assert.ok(content.includes('npm ci'));
  assert.ok(content.includes('npm run check'));
  assert.ok(content.includes('npm test'));
  assert.ok(content.includes('npm run release:manifest'));
  assert.ok(content.includes('node scripts/generate-sbom.mjs'));
  assert.ok(content.includes('docker inspect'));
});

test('gpg-attest.mjs exits 2 when gpg is unavailable', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [join(scriptBase, 'gpg-attest.mjs'), '--commit', '--key=test'], {
    cwd: repoRoot,
    env: { ...process.env, PATH: '/nonexistent' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });
  assert.equal(exitCode, 2);
  assert.ok(stderr.includes('GnuPG not available'));
});
