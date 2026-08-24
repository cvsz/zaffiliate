import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainEventBus } from '../packages/events/src/index.js';
import {
  validateMediaUpload,
  createLocalDriver,
  signObjectUrl,
  verifyObjectUrlSignature
} from '../packages/storage/src/index.js';

test('event bus publishes to subscribers with retry then dead-letter after exhaustion', () => {
  const bus = createDomainEventBus({ maxAttempts: 2 });
  const deadLetters = [];
  let attempts = 0;
  bus.subscribe('org-A', 'conversion.recorded', () => {
    attempts += 1;
    throw new Error('handler down');
  }, { deadLetterHandler: (event, error) => deadLetters.push({ event, error }) });

  bus.publish('org-A', { type: 'conversion.recorded', payload: { orderRef: 'o1' } });
  assert.equal(attempts, 2, 'retries before dead-lettering');
  assert.equal(deadLetters.length, 1);
  assert.match(deadLetters[0].error.message, /handler down/);
});

test('event bus isolates handler failures across subscribers and tenants', () => {
  const bus = createDomainEventBus({ maxAttempts: 1 });
  const seen = [];
  bus.subscribe('org-A', 'click.recorded', () => { throw new Error('first handler broken'); });
  bus.subscribe('org-A', 'click.recorded', (event) => seen.push(event.payload.linkId));
  bus.publish('org-A', { type: 'click.recorded', payload: { linkId: 'lnk_9' } });
  assert.deepEqual(seen, ['lnk_9'], 'healthy handlers must still run when a sibling fails');
  bus.publish('org-B', { type: 'click.recorded', payload: { linkId: 'other' } });
  assert.equal(seen.length, 1, 'tenant partitions never cross-deliver');
});

test('media validation enforces size caps, mime allowlist and safe keys', () => {
  const ok = validateMediaUpload({ filename: 'product.jpg', declaredMime: 'image/jpeg', sizeBytes: 1024, organizationId: 'org-X' });
  assert.equal(ok.allowed, true);
  assert.match(ok.objectKey, /^tenants\/org-X\/\d{4}\/\d{2}\/[a-f0-9]+\.jpg$/);

  const tooBig = validateMediaUpload({ filename: 'huge.png', declaredMime: 'image/png', sizeBytes: 50 * 1024 * 1024, organizationId: 'org-X' });
  assert.equal(tooBig.allowed, false);

  const evil = validateMediaUpload({ filename: '../../etc/passwd', declaredMime: 'application/x-msdownload', sizeBytes: 10, organizationId: 'org-X' });
  assert.equal(evil.allowed, false);
  assert.ok(!JSON.stringify(evil).includes('passwd'), 'rejected filenames must not leak paths');
});

test('local driver stores and retrieves bytes under tenant-prefixed immutable keys', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zaff-storage-'));
  try {
    const driver = createLocalDriver({ rootDir: root });
    const put = await driver.put('tenants/org-A/2026/08/abc.jpg', Buffer.from([1, 2, 3]), 'image/jpeg');
    assert.equal(put.stored, true);
    const get = await driver.get('tenants/org-A/2026/08/abc.jpg');
    assert.deepEqual(get.body, Buffer.from([1, 2, 3]));
    await assert.rejects(() => driver.get('../escape'), /invalid object key/i);
    await assert.rejects(() => driver.put('../escape', Buffer.from([0])), /invalid object key/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('signed urls are hmac-verified, expiring and tamper-proof', () => {
  const secret = 'signing-secret-value';
  const key = 'tenants/org-A/2026/08/deadbeef01.mp4';
  const url = signObjectUrl(key, { secret, expiresInSeconds: 300, now: 1756000000000 });
  assert.match(url, /^\/storage\/tenants%2Forg-A%2F2026%2F08%2Fdeadbeef01\.mp4\?/);
  assert.ok(verifyObjectUrlSignature(url, { secret, now: 1756000000000 + 1000 }).valid);
  const expired = verifyObjectUrlSignature(url, { secret, now: 1756000000000 + 301000 });
  assert.equal(expired.valid, false);
  const tampered = verifyObjectUrlSignature(url.replace('deadbeef01', 'feedface'), { secret, now: 1756000000000 + 1000 });
  assert.equal(tampered.valid, false);
});
