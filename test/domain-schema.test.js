import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PublicationJobStatus,
  CampaignStatus,
  CampaignTransitions,
  MerchantSchema,
  ProductSchema,
  OfferSchema,
  CampaignSchema,
  AffiliateLinkSchema,
  AffiliateClickSchema,
  ConversionSchema,
  ContentItemSchema,
  PublicationJobSchema,
  ExperimentSchema,
  ApprovalRequestSchema,
  WebhookEventSchema,
  AuditEventSchema,
  MembershipSchema,
  safeParse
} from '../packages/contracts/src/schema.js';

const UUID = '0b9e6c1a-1111-4222-8333-444455556666';
const UUID2 = '0b9e6c1a-aaaa-4bbb-8ccc-ddddeeeeffff';

test('merchant schema accepts valid records and rejects malformed ones', () => {
  const parsed = MerchantSchema.parse({
    id: UUID, orgId: UUID2, providerId: UUID, externalId: 'tt-123', name: 'Acme', createdAt: '2026-08-23T00:00:00.000Z'
  });
  assert.equal(parsed.externalId, 'tt-123');
  const bad = safeParse(MerchantSchema, { id: UUID, providerId: UUID, externalId: '', name: '' });
  assert.equal(bad.ok, false);
});

test('product schema enforces price and currency shape', () => {
  assert.equal(ProductSchema.safeParse({
    id: UUID, orgId: UUID2, merchantId: null, externalId: null, title: 'Thing', description: null,
    priceAmount: 19.99, currency: 'USD', status: 'discovered', metadata: {}, createdAt: '2026-08-23T00:00:00.000Z'
  }).ok, true);
  assert.equal(ProductSchema.safeParse({
    id: UUID, orgId: UUID2, merchantId: null, externalId: null, title: 'Thing', description: null,
    priceAmount: -1, currency: 'USDX', status: 'discovered', metadata: {}, createdAt: '2026-08-23T00:00:00.000Z'
  }).ok, false);
});

test('offer schema rejects percentage commissions above 100', () => {
  const base = {
    id: UUID, orgId: UUID2, productId: UUID, url: 'https://shop.example.com/p/1', commissionType: 'percentage',
    commissionValue: 100, promotionLabel: null, startsAt: null, endsAt: null, active: true, createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(OfferSchema.safeParse(base).ok, true);
  assert.equal(OfferSchema.safeParse({ ...base, commissionValue: 100.01 }).ok, false);
});

test('campaign status transitions are explicit and terminal states are closed', () => {
  assert.deepEqual(CampaignStatus, ['draft', 'active', 'paused', 'completed', 'cancelled']);
  assert.deepEqual(CampaignTransitions.completed, []);
  assert.ok(CampaignTransitions.draft.includes('active'));
  assert.ok(!CampaignTransitions.cancelled.includes('active'));
});

test('affiliate link slugs are lowercase dns-safe', () => {
  const link = {
    id: UUID, orgId: UUID2, campaignId: null, offerId: UUID, slug: 'summer-drop',
    targetUrl: 'https://shop.example.com/p/1?utm=x', utm: { source: 'tiktok' },
    expiresAt: null, createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(AffiliateLinkSchema.safeParse(link).ok, true);
  assert.equal(AffiliateLinkSchema.safeParse({ ...link, slug: 'Bad Slug' }).ok, false);
  assert.equal(AffiliateLinkSchema.safeParse({ ...link, targetUrl: 'http://insecure.example.com' }).ok, false);
});

test('clicks require tenant, link and occurredAt provenance', () => {
  assert.equal(AffiliateClickSchema.safeParse({
    id: UUID, orgId: UUID2, linkId: UUID, visitorHash: 'sha256hash', occurredAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  }).ok, true);
  assert.equal(AffiliateClickSchema.safeParse({ id: UUID, orgId: UUID2, linkId: '', visitorHash: 'x', occurredAt: 'nope' }).ok, false);
});

test('conversions reject negative money and unknown status', () => {
  const conversion = {
    id: UUID, orgId: UUID2, linkId: UUID, externalOrderId: 'ord-1', amount: 100,
    currency: 'USD', commissionAmount: 10, status: 'pending',
    occurredAt: '2026-08-23T00:00:00.000Z', recordedAt: '2026-08-23T00:00:01.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(ConversionSchema.safeParse(conversion).ok, true);
  assert.equal(ConversionSchema.safeParse({ ...conversion, amount: -5 }).ok, false);
  assert.equal(ConversionSchema.safeParse({ ...conversion, status: 'unknown' }).ok, false);
});

test('publication jobs use the canonical orchestration state machine', () => {
  assert.deepEqual(PublicationJobStatus, [
    'draft', 'waiting_approval', 'approved', 'scheduled', 'processing', 'published', 'partial', 'failed', 'cancelled'
  ]);
  const job = {
    id: UUID, orgId: UUID2, contentItemId: UUID, platform: 'tiktok',
    status: 'scheduled', idempotencyKey: 'pub-key-1', attempt: 0, maxAttempts: 5,
    nextRetryAt: null, providerResponse: null, externalContentId: null,
    failureCode: null, failureReason: null, scheduledFor: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(PublicationJobSchema.safeParse(job).ok, true);
  assert.equal(PublicationJobSchema.safeParse({ ...job, status: 'exploded' }).ok, false);
});

test('content items carry provenance fields for generation lineage', () => {
  const item = {
    id: UUID, orgId: UUID2, campaignId: UUID, productRef: 'prod-1', kind: 'video-script',
    promptVersion: 'v3', model: 'provider-neutral', version: 1, status: 'draft',
    body: { hook: 'x' }, disclosureRequired: true, createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(ContentItemSchema.safeParse(item).ok, true);
  assert.equal(ContentItemSchema.safeParse({ ...item, disclosureRequired: false, kind: 'video-script' }).ok, true);
  assert.equal(ContentItemSchema.safeParse({ ...item, version: 0 }).ok, false);
});

test('experiments never declare winners below the minimum sample floor', () => {
  const experiment = {
    id: UUID, orgId: UUID2, campaignId: UUID, hypothesis: 'hook-a-beats-hook-b',
    variants: [{ key: 'A', weight: 50 }, { key: 'B', weight: 50 }],
    minSamplesPerVariant: 100, status: 'running', winnerVariant: null, createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(ExperimentSchema.safeParse(experiment).ok, true);
  assert.equal(ExperimentSchema.safeParse({ ...experiment, winnerVariant: 'A' }).ok, false);
});

test('approval requests fail closed with expiry semantics', () => {
  const approval = {
    id: UUID, orgId: UUID2, subjectType: 'publication_job', subjectId: UUID,
    requestedBy: UUID, status: 'pending', reason: 'mutating publish',
    decidedBy: null, decision: null, expiresAt: '2026-08-30T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(ApprovalRequestSchema.safeParse(approval).ok, true);
  assert.equal(ApprovalRequestSchema.safeParse({ ...approval, decision: 'approved', decidedBy: null }).ok, false);
});

test('webhook events capture replay-proof identity', () => {
  const event = {
    id: UUID, orgId: UUID2, platform: 'tiktok', externalEventId: 'evt-77',
    signatureValid: true, payload: {}, receivedAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(WebhookEventSchema.safeParse(event).ok, true);
  assert.equal(WebhookEventSchema.safeParse({ ...event, signatureValid: false }).ok, true);
  assert.equal(WebhookEventSchema.safeParse({ ...event, platform: 'gopher' }).ok, false);
});

test('audit events stay append-only shaped', () => {
  const event = {
    id: UUID, orgId: UUID2, actorId: UUID2, action: 'publication.approve',
    resourceType: 'publication_job', resourceId: UUID, outcome: 'allowed',
    reason: 'granted', prevHash: 'deadbeef', entryHash: 'cafebabe',
    occurredAt: '2026-08-23T00:00:00.000Z', createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(AuditEventSchema.safeParse(event).ok, true);
  assert.equal(AuditEventSchema.safeParse({ ...event, outcome: 'meh' }).ok, false);
});

test('memberships bind actors to tenants with known roles', () => {
  const membership = {
    id: UUID, orgId: UUID2, actorId: UUID2, role: 'operator', status: 'active',
    createdAt: '2026-08-23T00:00:00.000Z'
  };
  assert.equal(MembershipSchema.safeParse(membership).ok, true);
  assert.equal(MembershipSchema.safeParse({ ...membership, role: 'emperor' }).ok, false);
});
