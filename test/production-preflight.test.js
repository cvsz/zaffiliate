import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const scriptPath = new URL('../scripts/production-preflight.mjs', import.meta.url).pathname;

function runPreflight(env) {
  const distDir = join(process.cwd(), 'dist-preflight-test');
  mkdirSync(distDir, { recursive: true });
  try {
    const result = spawnSync(process.execPath, [scriptPath], {
      env: { ...env },
      encoding: 'utf8',
      timeout: 30000
    });
    const evidence = JSON.parse(readFileSync(join(process.cwd(), 'dist', 'production-preflight.json'), 'utf8'));
    return { result, evidence };
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

const baseEnv = {
  DATABASE_URL: 'postgresql://u:p@db.invalid:5432/zaff',
  REDIS_URL: 'redis://:p@cache.invalid:6379/0',
  SESSION_SECRET: 'a'.repeat(64),
  ENCRYPTION_KEY: 'b'.repeat(64)
};

test('preflight: missing required secrets returns BLOCKED for each', () => {
  const { result, evidence } = runPreflight({});
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.stderr}`);
  assert.equal(evidence.decision, 'BLOCKED');
  const blockedNames = evidence.checks.filter((c) => c.status === 'BLOCKED').map((c) => c.name);
  for (const required of ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET', 'ENCRYPTION_KEY']) {
    assert.ok(blockedNames.includes(required), `expected ${required} BLOCKED, got: ${blockedNames.join(',')}`);
  }
});

test('preflight: TikTok pair transitions to READY_TO_PROBE when both present', () => {
  const { evidence } = runPreflight({
    ...baseEnv,
    TIKTOK_APP_KEY: 'fake_key',
    TIKTOK_APP_SECRET: 'fake_secret'
  });
  const tiktok = evidence.checks.find((c) => c.name === 'TIKTOK_LIVE_CREDENTIAL_PAIR');
  assert.equal(tiktok.status, 'READY_TO_PROBE');
  assert.match(tiktok.detail, /credentials present/);
});

test('preflight: META_CREDENTIALS_REF must start with ref:', () => {
  const { evidence } = runPreflight({
    ...baseEnv,
    META_CREDENTIALS_REF: 'not-a-ref'
  });
  const meta = evidence.checks.find((c) => c.name === 'META_CREDENTIALS_REF');
  assert.equal(meta.status, 'FAIL');
  assert.match(meta.detail, /must be a ref: credential reference/);
});

test('preflight: storage probe uses tenants/_probe/ key path that matches KEY_PATTERN', () => {
  const { evidence } = runPreflight({
    ...baseEnv,
    OBJECT_STORAGE_ENDPOINT: 'https://s3.fake.invalid',
    OBJECT_STORAGE_BUCKET: 'fake-bucket',
    OBJECT_STORAGE_ACCESS_KEY: 'AKIAFAKEFAKEFAKE',
    OBJECT_STORAGE_SECRET_KEY: 'c'.repeat(40)
  });
  const writeRead = evidence.checks.find((c) => c.name === 'OBJECT_STORAGE_WRITE_READ');
  assert.equal(writeRead.status, 'FAIL');
  assert.ok(
    !/invalid object key/.test(String(writeRead.detail)),
    `probe must reach the network call, not fail at key validation. detail=${writeRead.detail}`
  );
  assert.match(String(writeRead.detail), /fetch failed|getaddrinfo|ENOTFOUND|403|Forbidden/i);
});

test('preflight: missing storage config reports BLOCKED for storage variables', () => {
  const { evidence } = runPreflight({ ...baseEnv });
  const writeRead = evidence.checks.find((c) => c.name === 'OBJECT_STORAGE_WRITE_READ');
  assert.equal(writeRead.status, 'BLOCKED');
  for (const v of ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY']) {
    const c = evidence.checks.find((x) => x.name === v);
    assert.equal(c.status, 'BLOCKED', `expected ${v} BLOCKED`);
  }
});

test('preflight: clean evidence artifact is written and parseable', () => {
  const { evidence } = runPreflight({ ...baseEnv });
  assert.ok(evidence.generatedAt, 'generatedAt must be set');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(evidence.generatedAt), 'generatedAt must be ISO 8601');
  assert.ok(Array.isArray(evidence.checks));
  assert.equal(typeof evidence.decision, 'string');
  assert.ok(['READY_FOR_LIVE_PROVIDER_VERIFICATION', 'BLOCKED'].includes(evidence.decision));
});
