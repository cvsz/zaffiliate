import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyticsRuntime } from '../packages/analytics/src/runtime.js';

const BASE = Date.parse('2026-08-22T12:00:00.000Z');
const WINDOW = { from: BASE - 3600000, to: BASE };

function makeRuntime(overrides = {}) {
  return createAnalyticsRuntime({ clock: () => BASE, ...overrides });
}

function ingestChain(runtime, { tenantId = 't1', suffix = '', commission = 100, campaign = 'cmp1', product = 'p1', revenue = 5000, offsets = [300000, 240000, 180000, 120000, 60000] } = {}) {
  const [impressionOffset, clickOffset, cartOffset, orderOffset, conversionOffset] = offsets;
  runtime.ingestEvent({ tenantId, type: 'impression', eventId: `i${suffix}`, occurredAt: BASE - impressionOffset, campaignId: campaign, creativeId: `cr${suffix || '1'}`, productId: product });
  runtime.ingestEvent({ tenantId, type: 'click', eventId: `c${suffix}`, occurredAt: BASE - clickOffset, linkId: `l${suffix || '1'}`, impressionId: `i${suffix}`, campaignId: campaign, creativeId: `cr${suffix || '1'}`, productId: product });
  runtime.ingestEvent({ tenantId, type: 'cart', eventId: `ct${suffix}`, occurredAt: BASE - cartOffset, clickId: `c${suffix}`, campaignId: campaign, productId: product });
  runtime.ingestEvent({ tenantId, type: 'order', eventId: `o${suffix}`, occurredAt: BASE - orderOffset, cartId: `ct${suffix}`, revenueMinorUnits: revenue, currency: 'THB', campaignId: campaign, productId: product });
  return runtime.ingestEvent({ tenantId, type: 'conversion', eventId: `v${suffix}`, occurredAt: BASE - conversionOffset, orderId: `o${suffix}`, commissionMinorUnits: commission, campaignId: campaign, productId: product });
}

test('ingestEvent fails closed on per-type validation matrix', () => {
  const runtime = makeRuntime();
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'x' }), /occurredAt is required/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'pageview', eventId: 'x', occurredAt: BASE }), /unsupported analytics event type/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'click', eventId: 'x', occurredAt: BASE }), /linkId is required for click events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'cart', eventId: 'x', occurredAt: BASE }), /clickId is required for cart events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct' }), /revenueMinorUnits is required for order events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct', revenueMinorUnits: 10 }), /currency is required for order events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct', revenueMinorUnits: 10.5, currency: 'THB' }), /minor units/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct', revenueMinorUnits: -1, currency: 'THB' }), /minor units/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct', revenueMinorUnits: 10, currency: 'thb' }), /uppercase ISO currency/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'x', occurredAt: BASE, cartId: 'ct', revenueMinorUnits: 10, currency: 'EURO' }), /uppercase ISO currency/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'conversion', eventId: 'x', occurredAt: BASE }), /orderId is required for conversion events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'conversion', eventId: 'x', occurredAt: BASE, orderId: 'o' }), /commissionMinorUnits is required for conversion events/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'conversion', eventId: 'x', occurredAt: BASE, orderId: 'o', commissionMinorUnits: 1.5 }), /minor units/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: '', occurredAt: BASE }), /eventId is required/);
});

test('duplicate eventId is an idempotent no-op within a tenant partition', () => {
  const runtime = makeRuntime();
  const first = ingestChain(runtime);
  assert.ok(Object.isFrozen(first));
  const payload = { tenantId: 't1', type: 'conversion', eventId: 'v', occurredAt: BASE - 60000, orderId: 'o', commissionMinorUnits: 999 };
  assert.deepEqual(runtime.ingestEvent(payload), { duplicate: true });
  const funnel = runtime.funnel('t1', WINDOW);
  assert.equal(funnel.conversion, 1);
  const attributeRows = runtime.attribute('t1', 'v', { model: 'last_touch' });
  assert.equal(attributeRows[0].creditMinorUnits, 100);
  runtime.ingestEvent({ tenantId: 't2', type: 'impression', eventId: 'i', occurredAt: BASE - 60000 });
  assert.equal(runtime.funnel('t2', WINDOW).impression, 1);
  assert.equal(runtime.funnel('t1', WINDOW).impression, 1);
});

test('events outside the late-arrival window or in the future are rejected', () => {
  const runtime = makeRuntime();
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'edge_old', occurredAt: BASE - 86400000 });
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'edge_future', occurredAt: BASE + 60000 });
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'too_late', occurredAt: BASE - 86400001 }), /event_too_late/);
  assert.throws(() => runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'in_future', occurredAt: BASE + 60001 }), /event_in_future/);
  const strict = makeRuntime({ lateArrivalWindowMs: 1000 });
  assert.throws(() => strict.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'old', occurredAt: BASE - 2000 }), /event_too_late/);
  strict.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'fresh', occurredAt: BASE - 1000 });
});

test('linear attribution splits 100 minor units across three touchpoints exactly', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  const rows = runtime.attribute('t1', 'v', { model: 'linear' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.creditMinorUnits), [34, 33, 33]);
  assert.deepEqual(rows.map((row) => row.touchpointType), ['impression', 'click', 'cart']);
  assert.deepEqual(rows.map((row) => row.eventId), ['i', 'c', 'ct']);
  assert.deepEqual(rows.map((row) => row.linkId), [null, 'l1', null]);
  for (const row of rows) assert.equal(row.share, 1 / 3);
  assert.equal(rows.reduce((sum, row) => sum + row.creditMinorUnits, 0), 100);
});

test('single-touch attribution models concentrate credit and accept order references', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  const lastTouch = runtime.attribute('t1', 'v', { model: 'last_touch' });
  assert.deepEqual(lastTouch, [{ touchpointType: 'click', eventId: 'c', linkId: 'l1', share: 1, creditMinorUnits: 100 }]);
  const firstTouchByOrder = runtime.attribute('t1', 'o', { model: 'first_touch' });
  assert.deepEqual(firstTouchByOrder, [{ touchpointType: 'impression', eventId: 'i', linkId: null, share: 1, creditMinorUnits: 100 }]);
  const defaultModel = runtime.attribute('t1', 'v');
  assert.equal(defaultModel.length, 1);
  assert.equal(defaultModel[0].touchpointType, 'click');
  assert.throws(() => runtime.attribute('t1', 'v', { model: 'time_decay' }), /unsupported attribution model/);
  for (const row of [...lastTouch, ...firstTouchByOrder]) assert.ok(Object.isFrozen(row));
});

test('linear splits always sum exactly to the recorded commission with remainder to earliest touchpoint', () => {
  for (const total of [100, 7, 3, 1, 997]) {
    const runtime = makeRuntime();
    ingestChain(runtime, { suffix: `_t${total}`, commission: total });
    const rows = runtime.attribute('t1', `v_t${total}`, { model: 'linear' });
    assert.equal(rows.reduce((sum, row) => sum + row.creditMinorUnits, 0), total);
    assert.equal(rows[0].creditMinorUnits, Math.ceil(total / 3));
    assert.equal(rows[rows.length - 1].creditMinorUnits, Math.floor(total / 3));
  }
  const zeroRuntime = makeRuntime();
  ingestChain(zeroRuntime, { suffix: '_z', commission: 0 });
  const zeroRows = zeroRuntime.attribute('t1', 'v_z', { model: 'linear' });
  assert.deepEqual(zeroRows.map((row) => row.creditMinorUnits), [0, 0, 0]);
});

test('funnel counts stages inside the window and derives drop-off rates', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'i2', occurredAt: BASE - 90000 });
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'ancient', occurredAt: BASE - 7200000 });
  const funnel = runtime.funnel('t1', WINDOW);
  assert.equal(funnel.impression, 2);
  assert.equal(funnel.click, 1);
  assert.equal(funnel.cart, 1);
  assert.equal(funnel.order, 1);
  assert.equal(funnel.conversion, 1);
  assert.deepEqual(funnel.dropOffRates, { impressionToClick: 0.5, clickToCart: 0, cartToOrder: 0, orderToConversion: 0 });
  const narrow = runtime.funnel('t1', { from: BASE - 300000, to: BASE - 120000 });
  assert.deepEqual([narrow.impression, narrow.click, narrow.conversion], [1, 1, 0]);
  const empty = runtime.funnel('tenant_none', { from: BASE - 3600000, to: BASE });
  assert.deepEqual(empty, { impression: 0, click: 0, cart: 0, order: 0, conversion: 0, dropOffRates: { impressionToClick: 0, clickToCart: 0, cartToOrder: 0, orderToConversion: 0 } });
  assert.throws(() => runtime.funnel('t1', { from: BASE, to: BASE - 3600000 }), /from must not be after to/);
});

test('performance aggregation buckets by campaign, creative and product dimensions', () => {
  const runtime = makeRuntime();
  ingestChain(runtime, { suffix: '', campaign: 'alpha', product: 'p1', revenue: 5000, commission: 100 });
  ingestChain(runtime, { suffix: 'b', campaign: 'beta', product: 'p2', revenue: 2500, commission: 50 });
  const byCampaign = runtime.performanceByDimension('t1', 'campaign', WINDOW);
  assert.deepEqual(Object.keys(byCampaign), ['alpha', 'beta']);
  assert.deepEqual(byCampaign.alpha, { impressions: 1, clicks: 1, orders: 1, revenueMinorUnits: 5000, commissionMinorUnits: 100 });
  assert.deepEqual(byCampaign.beta, { impressions: 1, clicks: 1, orders: 1, revenueMinorUnits: 2500, commissionMinorUnits: 50 });
  const byProduct = runtime.performanceByDimension('t1', 'product', WINDOW);
  assert.deepEqual(Object.keys(byProduct), ['p1', 'p2']);
  assert.equal(byProduct.p2.commissionMinorUnits, 50);
  const byCreative = runtime.performanceByDimension('t1', 'creative', WINDOW);
  assert.deepEqual(Object.keys(byCreative), ['cr1', 'crb']);
  assert.throws(() => runtime.performanceByDimension('t1', 'link', WINDOW), /unsupported performance dimension/);
});

test('cohort funnel buckets stage counts by UTC calendar date of occurredAt', () => {
  const runtime = makeRuntime();
  const dayA = Date.parse('2026-08-21T23:30:00.000Z');
  const dayB = Date.parse('2026-08-22T06:00:00.000Z');
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'ia', occurredAt: dayA });
  runtime.ingestEvent({ tenantId: 't1', type: 'click', eventId: 'ca', occurredAt: dayA, linkId: 'la' });
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'ib', occurredAt: dayB });
  const rows = runtime.cohortFunnel('t1', { from: dayA, to: dayB });
  assert.deepEqual(rows, [
    { date: '2026-08-21', impression: 1, click: 1, cart: 0, order: 0, conversion: 0 },
    { date: '2026-08-22', impression: 1, click: 0, cart: 0, order: 0, conversion: 0 }
  ]);
});

test('anomaly rules validate strictly and evaluate against windowed metric actuals', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  assert.throws(() => runtime.registerAnomalyRule({ ruleId: 'r', metric: 'spike', comparator: '>', threshold: 1 }), /unsupported anomaly metric/);
  assert.throws(() => runtime.registerAnomalyRule({ ruleId: 'r', metric: 'click_count', comparator: '>=', threshold: 1 }), /unsupported anomaly comparator/);
  assert.throws(() => runtime.registerAnomalyRule({ ruleId: 'r', metric: 'click_count', comparator: '>', threshold: 'lots' }), /threshold must be a finite number/);
  runtime.registerAnomalyRule({ ruleId: 'high_clicks', metric: 'click_count', comparator: '>', threshold: 0 });
  runtime.registerAnomalyRule({ ruleId: 'low_commission', metric: 'commission_total', comparator: '<', threshold: 150 });
  runtime.registerAnomalyRule({ ruleId: 'no_conversions', metric: 'order_count', comparator: '>', threshold: 5 });
  assert.throws(() => runtime.registerAnomalyRule({ ruleId: 'high_clicks', metric: 'click_count', comparator: '>', threshold: 9 }), /already exists/);
  const triggered = runtime.evaluateAnomalies('t1', WINDOW);
  assert.deepEqual(triggered, [
    { ruleId: 'high_clicks', metric: 'click_count', actual: 1, threshold: 0 },
    { ruleId: 'low_commission', metric: 'commission_total', actual: 100, threshold: 150 }
  ]);
});

test('csv export escapes quotes, commas and newlines per RFC 4180', () => {
  const runtime = makeRuntime();
  const weird = 'camp, "x"\nline';
  runtime.ingestEvent({ tenantId: 't1', type: 'impression', eventId: 'wi', occurredAt: BASE - 60000, campaignId: weird });
  runtime.ingestEvent({ tenantId: 't1', type: 'click', eventId: 'wc', occurredAt: BASE - 55000, linkId: 'lw' });
  const csv = runtime.exportData('t1', { format: 'csv', dataset: 'performance', dimension: 'campaign', params: WINDOW });
  const expectedLines = [
    'dimension,dimensionValue,impressions,clicks,orders,revenueMinorUnits,commissionMinorUnits',
    'campaign,"camp, ""x""\nline",1,0,0,0,0'
  ];
  assert.equal(csv, expectedLines.join('\n'));
  const funnelCsv = runtime.exportData('t1', { format: 'csv', dataset: 'funnel', params: WINDOW });
  assert.equal(funnelCsv, 'date,impression,click,cart,order,conversion\n2026-08-22,1,1,0,0,0');
});

test('json export is deterministic with stable key order across calls', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  ingestChain(runtime, { suffix: 'b', campaign: 'beta' });
  const funnelJsonOne = runtime.exportData('t1', { format: 'json', dataset: 'funnel', params: WINDOW });
  const funnelJsonTwo = runtime.exportData('t1', { format: 'json', dataset: 'funnel', params: WINDOW });
  assert.equal(funnelJsonOne, funnelJsonTwo);
  const funnelRows = JSON.parse(funnelJsonOne);
  assert.deepEqual(Object.keys(funnelRows[0]), ['date', 'impression', 'click', 'cart', 'order', 'conversion']);
  const performanceJsonOne = runtime.exportData('t1', { format: 'json', dataset: 'performance', dimension: 'campaign', params: WINDOW });
  const performanceJsonTwo = runtime.exportData('t1', { format: 'json', dataset: 'performance', dimension: 'campaign', params: WINDOW });
  assert.equal(performanceJsonOne, performanceJsonTwo);
  const performanceRows = JSON.parse(performanceJsonOne);
  assert.deepEqual(Object.keys(performanceRows[0]), ['dimension', 'dimensionValue', 'impressions', 'clicks', 'orders', 'revenueMinorUnits', 'commissionMinorUnits']);
  assert.throws(() => runtime.exportData('t1', { format: 'xml', dataset: 'funnel', params: WINDOW }), /unsupported export format/);
  assert.throws(() => runtime.exportData('t1', { format: 'json', dataset: 'ledger', params: WINDOW }), /unsupported export dataset/);
  assert.throws(() => runtime.exportData('t1', { format: 'json', dataset: 'performance', params: WINDOW }), /dimension is required/);
});

test('reconciliation balances consistent data and exposes delta after store tampering', () => {
  const runtime = makeRuntime();
  ingestChain(runtime);
  const balanced = runtime.reconcileCommissions('t1', WINDOW);
  assert.deepEqual(balanced, { balanced: true, attributedTotalMinorUnits: 100, recordedTotalMinorUnits: 100, deltaMinorUnits: 0 });
  const scope = runtime.__testScope('t1');
  scope.events.delete('c');
  const tampered = runtime.reconcileCommissions('t1', WINDOW);
  assert.deepEqual(tampered, { balanced: false, attributedTotalMinorUnits: 0, recordedTotalMinorUnits: 100, deltaMinorUnits: -100 });
  assert.throws(() => runtime.attribute('t1', 'v'), /attribution_chain_broken:click/);
  const orphanRuntime = makeRuntime();
  ingestChain(orphanRuntime);
  orphanRuntime.ingestEvent({ tenantId: 't1', type: 'conversion', eventId: 'v_ghost', occurredAt: BASE - 30000, orderId: 'o_missing', commissionMinorUnits: 40 });
  const orphaned = orphanRuntime.reconcileCommissions('t1', WINDOW);
  assert.deepEqual(orphaned, { balanced: false, attributedTotalMinorUnits: 100, recordedTotalMinorUnits: 140, deltaMinorUnits: -40 });
});

test('cross-tenant references are rejected instead of leaking data', () => {
  const runtime = makeRuntime();
  ingestChain(runtime, { tenantId: 't1' });
  assert.throws(() => runtime.attribute('t2', 'v'), /cross_tenant_access/);
  assert.equal(runtime.funnel('t2', WINDOW).conversion, 0);
});

test('stored records and returned aggregates are immutable contracts', () => {
  const runtime = makeRuntime();
  const record = runtime.ingestEvent({ tenantId: 't1', type: 'order', eventId: 'of', occurredAt: BASE - 1000, cartId: 'ctf', revenueMinorUnits: 10, currency: 'USD' });
  assert.ok(Object.isFrozen(record));
  assert.equal(record.occurredAt, new Date(BASE - 1000).toISOString());
  ingestChain(runtime);
  const performance = runtime.performanceByDimension('t1', 'campaign', WINDOW);
  assert.ok(Object.isFrozen(performance));
  assert.ok(Object.isFrozen(performance.cmp1));
  const cohort = runtime.cohortFunnel('t1', WINDOW);
  assert.ok(Object.isFrozen(cohort));
  assert.ok(Object.isFrozen(cohort[0]));
});
