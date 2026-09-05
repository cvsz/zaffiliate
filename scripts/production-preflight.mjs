import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createS3Driver } from '../packages/storage/src/s3.js';

const now = new Date().toISOString();
const checks = [];
const add = (name, status, detail = null) => checks.push({ name, status, detail });

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    add(name, 'BLOCKED', 'missing');
    return null;
  }
  add(name, 'PASS', 'present');
  return value;
}

function optionalRef(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    add(name, 'NOT_CONFIGURED');
    return null;
  }
  if (!value.startsWith('ref:')) {
    add(name, 'FAIL', 'must be a ref: credential reference, never a raw token');
    return null;
  }
  add(name, 'PASS', 'credential reference configured');
  return value;
}

required('DATABASE_URL');
required('REDIS_URL');
required('SESSION_SECRET');
required('ENCRYPTION_KEY');

const endpoint = required('OBJECT_STORAGE_ENDPOINT');
const bucket = required('OBJECT_STORAGE_BUCKET');
const accessKeyId = required('OBJECT_STORAGE_ACCESS_KEY');
const secretAccessKey = required('OBJECT_STORAGE_SECRET_KEY');

const tiktokKey = String(process.env.TIKTOK_APP_KEY ?? '').trim();
const tiktokSecret = String(process.env.TIKTOK_APP_SECRET ?? '').trim();
if (tiktokKey && tiktokSecret) {
  add('TIKTOK_LIVE_CREDENTIAL_PAIR', 'READY_TO_PROBE', 'credentials present; run the live provider probe in the approved environment');
} else {
  add('TIKTOK_LIVE_CREDENTIAL_PAIR', 'BLOCKED', 'production/review credentials not fully provisioned');
}

optionalRef('META_CREDENTIALS_REF');
optionalRef('YOUTUBE_CREDENTIALS_REF');

if (endpoint && bucket && accessKeyId && secretAccessKey) {
  const driver = createS3Driver({ endpoint, bucket, accessKeyId, secretAccessKey });
  const key = `preflight/${Date.now()}-probe.png`;
  // 1x1 transparent PNG, safe deterministic fixture.
  const body = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  try {
    const put = await driver.put(key, body, 'image/png');
    const got = await driver.get(key);
    const same = got && createHash('sha256').update(got.body).digest('hex') === createHash('sha256').update(body).digest('hex');
    if (!same) throw new Error('readback hash mismatch');
    add('OBJECT_STORAGE_WRITE_READ', 'PASS', { key, bytes: put.bytes, etag: put.etag ?? null });
  } catch (error) {
    add('OBJECT_STORAGE_WRITE_READ', 'FAIL', String(error?.message ?? error));
  }
} else {
  add('OBJECT_STORAGE_WRITE_READ', 'BLOCKED', 'storage configuration incomplete');
}

const hardFailures = checks.filter((c) => ['FAIL', 'BLOCKED'].includes(c.status));
const evidence = {
  generatedAt: now,
  commit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
  decision: hardFailures.length === 0 ? 'READY_FOR_LIVE_PROVIDER_VERIFICATION' : 'BLOCKED',
  checks
};

await mkdir('dist', { recursive: true });
await writeFile('dist/production-preflight.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ decision: evidence.decision, evidence: 'dist/production-preflight.json', checks: checks.map(({ name, status }) => ({ name, status })) }, null, 2));

if (hardFailures.length) process.exitCode = 2;
