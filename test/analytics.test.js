import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsEvent, dedupeAnalyticsEvents, attributeConversion, reconcileCommission, summarizeFunnel } from '../packages/analytics/src/domain.js';

test('analytics events record late-arrival quality signal', () => {
  const event = createAnalyticsEvent({ tenantId: 't1', eventId: 'e1', type: 'click', occurredAt: '2026-08-22T10:00:00Z', receivedAt: '2026-08-22T10:00:05Z' });
  assert.equal(event.lateArrivalMs, 5000);
});

test('dedupe key is tenant plus event id', () => {
  const a = createAnalyticsEvent({ tenantId: 't1', eventId: 'e1', type: 'click', occurredAt: '2026-08-22T10:00:00Z' });
  const duplicate = createAnalyticsEvent({ tenantId: 't1', eventId: 'e1', type: 'click', occurredAt: '2026-08-22T10:00:00Z' });
  const otherTenant = createAnalyticsEvent({ tenantId: 't2', eventId: 'e1', type: 'click', occurredAt: '2026-08-22T10:00:00Z' });
  assert.equal(dedupeAnalyticsEvents([a, duplicate, otherTenant]).length, 2);
});

test('multi-touch attribution supports first last and linear models', () => {
  const touches = [
    { touchpointId: 't1', occurredAt: '2026-08-22T09:00:00Z' },
    { touchpointId: 't2', occurredAt: '2026-08-22T10:00:00Z' },
    { touchpointId: 'future', occurredAt: '2026-08-23T10:00:00Z' }
  ];
  assert.deepEqual(attributeConversion({ touchpoints: touches, conversionOccurredAt: '2026-08-22T11:00:00Z', model: 'first_touch' }), [{ touchpointId: 't1', weight: 1 }]);
  assert.deepEqual(attributeConversion({ touchpoints: touches, conversionOccurredAt: '2026-08-22T11:00:00Z', model: 'last_touch' }), [{ touchpointId: 't2', weight: 1 }]);
  const linear = attributeConversion({ touchpoints: touches, conversionOccurredAt: '2026-08-22T11:00:00Z', model: 'linear' });
  assert.equal(linear.length, 2);
  assert.equal(linear[0].weight, 0.5);
});

test('commission reconciliation exposes delta and tolerance result', () => {
  assert.equal(reconcileCommission({ expectedCommission: 100, reportedCommission: 100.005, tolerance: 0.01 }).reconciled, true);
  assert.equal(reconcileCommission({ expectedCommission: 100, reportedCommission: 95, tolerance: 0.01 }).reconciled, false);
});

test('funnel summary computes CTR and conversion rate', () => {
  const events = [
    createAnalyticsEvent({ tenantId: 't1', eventId: 'i1', type: 'impression', occurredAt: '2026-08-22T10:00:00Z' }),
    createAnalyticsEvent({ tenantId: 't1', eventId: 'i2', type: 'impression', occurredAt: '2026-08-22T10:00:01Z' }),
    createAnalyticsEvent({ tenantId: 't1', eventId: 'c1', type: 'click', occurredAt: '2026-08-22T10:00:02Z' }),
    createAnalyticsEvent({ tenantId: 't1', eventId: 'v1', type: 'conversion', occurredAt: '2026-08-22T10:00:03Z' })
  ];
  const funnel = summarizeFunnel(events);
  assert.equal(funnel.clickThroughRate, 0.5);
  assert.equal(funnel.conversionRate, 1);
});
