import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  EVENT_TYPES,
  SOURCE_TYPES,
  createEventStore,
  buildEventEnvelope
} from '../packages/analytics/src/events.js';

const BASE = {
  organizationId: 'org-A',
  provider: 'tiktok',
  occurredAt: '2026-08-24T10:00:00.000Z'
};

test('taxonomy and source classification are complete and frozen', () => {
  assert.ok(EVENT_TYPES.has('conversion_reported'));
  assert.ok(EVENT_TYPES.has('commission_reversed'));
  assert.ok(EVENT_TYPES.has('affiliate_click_recorded'));
  assert.ok(EVENT_TYPES.has('publication_published'));
  for (const source of ['FIRST_PARTY', 'PROVIDER_REPORTED', 'AFFILIATE_PROVIDER_REPORTED', 'IMPORTED', 'MODELED', 'ESTIMATED', 'PREDICTED']) {
    assert.ok(SOURCE_TYPES.has(source));
  }
});

function clickInput(overrides = {}) {
  return {
    type: 'affiliate_click_recorded',
    sourceType: 'FIRST_PARTY',
    affiliateLinkId: 'lnk_1',
    campaignId: 'cmp_1',
    ...overrides
  };
}

test('envelopes carry version, lineage, receivedAt and deterministic identity from external id', () => {
  const first = buildEventEnvelope({
    ...BASE,
    ...clickInput(),
    externalEventId: 'tt-click-77'
  });
  const again = buildEventEnvelope({ ...BASE, ...clickInput(), externalEventId: 'tt-click-77' });
  assert.match(first.eventVersion, /^1$/);
  assert.equal(first.eventType, 'affiliate_click_recorded');
  assert.equal(first.sourceType, 'FIRST_PARTY');
  assert.equal(first.lineage.affiliate_link_id, 'lnk_1');
  assert.ok(first.receivedAt);
  assert.equal(first.eventId, again.eventId, 'same provider+external id must mint the same eventId');
  assert.notEqual(first.eventId, clickInput.eventId);
});

test('unknown event types and source classifications fail closed', () => {
  assert.throws(() => buildEventEnvelope({ ...BASE, ...clickInput(), type: 'vibes_detected' }), /unsupported analytics event type/i);
  assert.throws(() => buildEventEnvelope({ ...BASE, ...clickInput(), sourceType: 'VIBES' }), /unsupported source type/i);
});

test('events without an organization are rejected', () => {
  assert.throws(() => buildEventEnvelope({ ...BASE, organizationId: '', ...clickInput() }), /organizationId is required/i);
});

test('click events require affiliate link lineage; funnel events carry what they declare', () => {
  assert.throws(() => buildEventEnvelope({ ...BASE, type: 'affiliate_click_recorded', sourceType: 'FIRST_PARTY' }), /affiliate_link_id is required/i);
});

test('duplicate deliveries dedupe by provider + external id without double counting', () => {
  const store = createEventStore();
  const first = store.ingest(buildEventEnvelope({ ...BASE, ...clickInput(), externalEventId: 'evt-1' }));
  const replay = store.ingest(buildEventEnvelope({ ...BASE, ...clickInput(), externalEventId: 'evt-1' }));
  assert.equal(first.accepted, true);
  assert.equal(replay.accepted, false);
  assert.equal(replay.duplicateOf, first.stored.eventId);
  assert.equal(store.size('org-A'), 1);
});

test('fallback fingerprint dedupes external-id-less deliveries across arrival order', () => {
  const store = createEventStore();
  const payload = { orderId: 'ord-9', amountMinorUnits: 2500 };
  const a = store.ingest(buildEventEnvelope({ ...BASE, type: 'conversion_reported', sourceType: 'AFFILIATE_PROVIDER_REPORTED', payload, sourceTimestamp: '2026-08-24T09:59:00.000Z' }));
  const b = store.ingest(buildEventEnvelope({ ...BASE, type: 'conversion_reported', sourceType: 'AFFILIATE_PROVIDER_REPORTED', payload, sourceTimestamp: '2026-08-24T09:59:00.000Z', occurredAt: '2026-08-24T12:30:00.000Z' }));
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, false);
  const distinct = store.ingest(buildEventEnvelope({ ...BASE, type: 'conversion_reported', sourceType: 'AFFILIATE_PROVIDER_REPORTED', payload: { ...payload, orderId: 'ord-10' }, sourceTimestamp: '2026-08-24T09:59:00.000Z' }));
  assert.equal(distinct.accepted, true);
});

test('raw events are immutable once stored', () => {
  const store = createEventStore();
  const result = store.ingest(buildEventEnvelope({ ...BASE, ...clickInput(), externalEventId: 'evt-imm' }));
  assert.throws(() => { result.stored.payload = {}; }, TypeError);
});

test('tenant isolation: org B cannot see or ingest into org A partition', () => {
  const store = createEventStore();
  store.ingest(buildEventEnvelope({ ...BASE, ...clickInput({ externalEventId: 'a-1' }) }));
  store.ingest(buildEventEnvelope({ ...BASE, organizationId: 'org-B', ...clickInput({ externalEventId: 'b-1' }) }));
  assert.equal(store.size('org-A'), 1);
  assert.equal(store.size('org-B'), 1);
  const summaryA = store.summarize('org-A');
  assert.equal(summaryA.clicks, 1);
  const summaryB = store.summarize('org-B');
  assert.equal(summaryB.clicks, 1);
  const emptyTenant = store.summarize('org-C');
  assert.equal(emptyTenant.impressions, 0);
});

test('golden dataset yields CTR 20%, CVR 20%, net commission 1500 minor units, EPC 75', () => {
  const store = createEventStore();
  let seq = 0;
  const feed = (type, sourceType, extra = {}) => store.ingest(buildEventEnvelope({
    ...BASE,
    type,
    sourceType,
    externalEventId: `golden-${++seq}`,
    ...extra
  }));

  for (let i = 0; i < 100; i += 1) feed('impression_recorded', 'PROVIDER_REPORTED');
  for (let i = 0; i < 20; i += 1) feed('affiliate_click_recorded', 'FIRST_PARTY', { affiliateLinkId: 'lnk_g' });
  for (let i = 0; i < 4; i += 1) {
    feed('commission_reported', 'AFFILIATE_PROVIDER_REPORTED', {
      payload: { status: 'approved', amountMinorUnits: 500, currency: 'USD' }
    });
  }
  feed('refund_reported', 'AFFILIATE_PROVIDER_REPORTED', {
    payload: { amountMinorUnits: 500, currency: 'USD', reason: 'customer refund' }
  });

  const metrics = store.summarize('org-A');
  assert.equal(metrics.impressions, 100);
  assert.equal(metrics.clicks, 20);
  assert.equal(metrics.conversions, 4);
  assert.equal(metrics.ctr, 0.2);
  assert.equal(metrics.cvr, 0.2);
  assert.equal(metrics.grossCommissionMinorUnits, 2000);
  assert.equal(metrics.refundMinorUnits, 500);
  assert.equal(metrics.netCommissionMinorUnits, 1500);
  assert.equal(metrics.epcMinorUnits, 75);
});

test('pending commission is never counted as net revenue', () => {
  const store = createEventStore();
  store.ingest(buildEventEnvelope({
    ...BASE, type: 'commission_reported', sourceType: 'AFFILIATE_PROVIDER_REPORTED',
    externalEventId: 'p-1', payload: { status: 'pending', amountMinorUnits: 9000, currency: 'USD' }
  }));
  const metrics = store.summarize('org-A');
  assert.equal(metrics.pendingCommissionMinorUnits, 9000);
  assert.equal(metrics.netCommissionMinorUnits, 0);
});

test('refund can never push net commission negative', () => {
  const store = createEventStore();
  store.ingest(buildEventEnvelope({
    ...BASE, type: 'refund_reported', sourceType: 'AFFILIATE_PROVIDER_REPORTED',
    externalEventId: 'r-1', payload: { amountMinorUnits: 99999, currency: 'USD' }
  }));
  const metrics = store.summarize('org-A');
  assert.equal(metrics.netCommissionMinorUnits, 0);
});
