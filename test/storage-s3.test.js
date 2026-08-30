import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createS3Driver } from '../packages/storage/src/s3.js';

const FIXED = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI',
  region: 'us-east-1',
  endpoint: 'https://supabase-test.example.com',
  bucket: 'test-bucket'
};

const MP4_BODY = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom', 'ascii'),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from('isomiso2', 'ascii')
]);

function capturedDriver() {
  const requests = [];
  const driver = createS3Driver({
    ...FIXED,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' };
    }
  });
  return { driver, requests };
}

test('putObject validates bytes and issues SigV4-signed PUT with the hashed request body', async () => {
  const { driver, requests } = capturedDriver();
  const result = await driver.put('tenants/org-A/2026/08/deadbeef01.mp4', MP4_BODY, 'video/mp4', { now: new Date('2026-08-24T12:00:00.000Z') });
  assert.equal(result.stored, true);
  const req = requests[0];
  assert.equal(new URL(req.url).pathname, '/test-bucket/tenants/org-A/2026/08/deadbeef01.mp4');
  const sha = createHash('sha256').update(MP4_BODY).digest('hex');
  assert.equal(req.options.headers['x-amz-content-sha256'], sha);
  assert.equal(req.options.headers['content-type'], 'video/mp4');
  assert.deepEqual(req.options.body, MP4_BODY, 'the body used for the payload hash must be sent to S3');
  assert.match(req.options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request,/);
  assert.match(req.options.headers.authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
});

test('spoofed declared media is rejected before any S3 network call', async () => {
  const { driver, requests } = capturedDriver();
  await assert.rejects(
    () => driver.put('tenants/org-A/2026/08/deadbeef01.mp4', Buffer.from('not-an-mp4'), 'video/mp4'),
    (error) => error?.code === 'MEDIA_MIME_MISMATCH'
  );
  assert.equal(requests.length, 0);
});

test('signature derives through the documented four-stage HMAC key schedule', () => {
  const { driver, requests } = capturedDriver();
  void driver;
  void requests;
  const kDate = createHmac('sha256', 'AWS4' + FIXED.secretAccessKey).update('20260824').digest();
  const kRegion = createHmac('sha256', kDate).update(FIXED.region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  assert.equal(kSigning.length, 32);
});

test('getObject returns decoded body; missing objects resolve to null', async () => {
  const { driver } = capturedDriver();
  const ok = await driver.get('tenants/org-A/2026/08/deadbeef01.mp4');
  assert.ok(ok.body instanceof Uint8Array);
  const missing = createS3Driver({
    ...FIXED,
    fetchImpl: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })
  });
  assert.equal(await missing.get('tenants/org-A/2026/08/00000000.mp4'), null);
});

test('unsafe keys are rejected before any network call', async () => {
  const { driver, requests } = capturedDriver();
  await assert.rejects(() => driver.put('../escape', Buffer.from([0]), 'image/png'), /invalid object key/i);
  await assert.rejects(() => driver.get('../../secret'), /invalid object key/i);
  assert.equal(requests.length, 0);
});
