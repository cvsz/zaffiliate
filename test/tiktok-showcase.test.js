import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokShowcaseService, TIKTOK_SHOWCASE_DISCLOSURES } from '../packages/ai-content/src/tiktok-showcase.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

test('generateShowcasePackage creates Thai script, scored hooks, and compliance disclosures', () => {
  const service = createTikTokShowcaseService();
  const pkg = service.generateShowcasePackage({
    tenantId: TENANT_ID,
    productId: 'prod_camera_123',
    productName: 'กล้องวงจรปิดไร้สาย',
    priceMinorUnits: 49900,
    currency: 'THB',
    keyFeatures: ['ดูผ่านมือถือได้', 'คมชัด 2K', 'มีสัญญาณเตือน'],
    affiliateUrl: 'https://zaff.link/cam1',
    language: 'th'
  });

  assert.equal(pkg.tenantId, TENANT_ID);
  assert.equal(pkg.productId, 'prod_camera_123');
  assert.equal(pkg.hooks.length, 3);
  assert.ok(pkg.hooks[0].score > 80);
  assert.ok(pkg.caption.includes('#TikTokMadeMeBuyIt'));
  assert.ok(pkg.caption.includes('#นายหน้าtiktok'));
  assert.ok(pkg.caption.includes('#ad'));
  assert.equal(pkg.script.durationSeconds, 30);
  assert.equal(pkg.script.aspectRatio, '9:16');
  assert.equal(pkg.script.beats.length, 4);
  assert.ok(pkg.provenance.inputHash.length === 64);
});

test('generateShowcasePackage supports English language option', () => {
  const service = createTikTokShowcaseService();
  const pkg = service.generateShowcasePackage({
    tenantId: TENANT_ID,
    productId: 'prod_wireless_mic',
    productName: 'Wireless Lavalier Microphone',
    priceMinorUnits: 2500,
    currency: 'USD',
    keyFeatures: ['Noise cancellation', 'Plug and play'],
    affiliateUrl: 'https://zaff.link/mic1',
    language: 'en'
  });

  assert.equal(pkg.script.language, 'en');
  assert.ok(pkg.caption.includes('#TikTokMadeMeBuyIt'));
  assert.ok(pkg.caption.includes('#Affiliate'));
  assert.ok(pkg.hooks[0].text.includes('Microphone'));
});

test('createShowcasePublicationJob creates scheduled publication job with idempotency', async () => {
  let createdPayload = null;
  const fakeRepo = {
    async create(tenant, input) {
      createdPayload = { tenant, ...input };
      return { created: true, job: { id: 'job_showcase_1', ...input } };
    }
  };

  const service = createTikTokShowcaseService({ publicationJobsRepo: fakeRepo });
  const pkg = service.generateShowcasePackage({
    tenantId: TENANT_ID,
    productId: 'prod_test',
    productName: 'Test Product',
    affiliateUrl: 'https://zaff.link/test'
  });

  const jobResult = await service.createShowcasePublicationJob({
    tenantId: TENANT_ID,
    showcasePackage: pkg,
    videoUrl: 'https://cdn.zaffiliate.com/test_video.mp4',
    accountId: 'acc_creator_99'
  });

  assert.equal(jobResult.created, true);
  assert.equal(createdPayload.platform, 'tiktok');
  assert.equal(createdPayload.status, 'scheduled');
  assert.ok(createdPayload.idempotencyKey.startsWith('ttpub_'));
  assert.equal(createdPayload.providerResponse.videoUrl, 'https://cdn.zaffiliate.com/test_video.mp4');
});
