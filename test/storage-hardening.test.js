import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  sniffMediaMime,
  validateMediaUpload,
  assertValidObjectKey,
  createLocalDriver,
  signObjectUrl,
  verifyObjectUrlSignature
} from '../packages/storage/src/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 0, 0])]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.from([0, 0, 0, 0])]);

test('magic-byte sniffer recognizes every allowed media family and fails unknown content closed', () => {
  assert.equal(sniffMediaMime(JPEG), 'image/jpeg');
  assert.equal(sniffMediaMime(PNG), 'image/png');
  assert.equal(sniffMediaMime(WEBP), 'image/webp');
  assert.equal(sniffMediaMime(WEBM), 'video/webm');
  assert.equal(sniffMediaMime(MP4), 'video/mp4');
  assert.equal(sniffMediaMime(MOV), 'video/quicktime');
  assert.equal(sniffMediaMime(Buffer.from('arbitrary bytes')), 'application/octet-stream');
});

test('metadata validation can bind declared mime and size to actual bytes', () => {
  const ok = validateMediaUpload({ filename: 'photo.jpg', declaredMime: 'image/jpeg', sizeBytes: JPEG.length, body: JPEG, organizationId: 'org-A' });
  assert.equal(ok.allowed, true);

  const spoofed = validateMediaUpload({ filename: 'photo.jpg', declaredMime: 'image/jpeg', sizeBytes: PNG.length, body: PNG, organizationId: 'org-A' });
  assert.equal(spoofed.allowed, false);
  assert.ok(spoofed.issues.includes('media bytes do not match declared mime'));

  const wrongSize = validateMediaUpload({ filename: 'photo.jpg', declaredMime: 'image/jpeg', sizeBytes: JPEG.length + 1, body: JPEG, organizationId: 'org-A' });
  assert.equal(wrongSize.allowed, false);
  assert.ok(wrongSize.issues.includes('declared size does not match body length'));

  const badTenant = validateMediaUpload({ filename: 'photo.jpg', declaredMime: 'image/jpeg', sizeBytes: JPEG.length, body: JPEG, organizationId: '../other' });
  assert.equal(badTenant.allowed, false);
});

test('object-key policy rejects traversal, encoded separators, absolute forms and oversized keys', () => {
  const valid = 'tenants/org-A/2026/08/deadbeef01.mp4';
  assert.equal(assertValidObjectKey(valid), valid);
  for (const key of [
    '../escape',
    'tenants/org-A/2026/08/../x.mp4',
    'tenants/org-A/2026/08/%2f.mp4',
    'tenants/org-A/2026/08/%5c.mp4',
    'tenants\\org-A\\2026\\08\\a.mp4',
    '/tenants/org-A/2026/08/a.mp4',
    'C:/tenants/org-A/2026/08/a.mp4',
    'tenants/org-A//08/a.mp4',
    `tenants/org-A/2026/08/${'a'.repeat(600)}.mp4`,
    `tenants/org-A/2026/08/a\0.mp4`
  ]) {
    assert.throws(() => assertValidObjectKey(key), /invalid object key/i, key);
  }
});

test('local storage rejects spoofed content before writing bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zaff-storage-hardening-'));
  const driver = createLocalDriver({ rootDir: root });
  const key = 'tenants/org-A/2026/08/deadbeef01.jpg';
  try {
    await assert.rejects(() => driver.put(key, PNG, 'image/jpeg'), (error) => error?.code === 'MEDIA_MIME_MISMATCH');
    await assert.rejects(() => access(path.join(root, key)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('signed URL verification is strict about path and signature encoding', () => {
  const key = 'tenants/org-A/2026/08/deadbeef01.mp4';
  const secret = 'storage-signing-secret';
  const now = 1_756_000_000_000;
  const signed = signObjectUrl(key, { secret, now, expiresInSeconds: 60 });
  assert.equal(verifyObjectUrlSignature(signed, { secret, now: now + 1000 }).valid, true);
  assert.equal(verifyObjectUrlSignature('/other/path?expires=9999999999999&signature=' + 'a'.repeat(32), { secret, now }).valid, false);
  assert.equal(verifyObjectUrlSignature(signed.replace(/signature=[a-f0-9]+/, 'signature=not-hex'), { secret, now }).valid, false);
  assert.equal(verifyObjectUrlSignature(signed.replace(/signature=./, 'signature=A'), { secret, now }).valid, false);
});
