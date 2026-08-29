import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAffiliateRuntime } from '../packages/affiliate-core/src/runtime.js';

function fixedClock(start = 1755820000000) {
  let current = start;
  return () => {
    current += 1000;
    return current;
  };
}

function isoAt(ms) {
  return new Date(ms).toISOString();
}

test('end-to-end lifecycle: product -> offer -> link -> click -> conversion -> commission -> margin', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });

  const product = runtime.registerProduct('tenant-a', {
    productId: 'p1',
    platform: 'TikTok',
    externalProductId: 'ext-1',
    title: 'Demo Product',
    currency: 'THB'
  });
  assert.equal(product.tenantId, 'tenant-a');
  assert.equal(product.productId, 'p1');
  assert.equal(product.platform, 'tiktok');

  const offer = runtime.publishOffer('tenant-a', {
    productId: 'p1',
    price: 150000,
    currency: 'THB',
    commissionRate: 0.08
  });
  assert.equal(offer.priceMinorUnits, 150000);
  assert.equal(offer.currency, 'THB');
  assert.equal(offer.commissionRate, 0.08);
  assert.ok(Number.isSafeInteger(offer.priceMinorUnits));
  assert.match(offer.offerId, /^off_/);

  const link = runtime.generateLink('tenant-a', {
    offerId: offer.offerId,
    destinationUrl: 'https://shop.example.com/item/ext-1?ref=catalog',
    subIds: ['utm_campaign', 'sid']
  });
  assert.equal(link.offerId, offer.offerId);
  assert.equal(link.productId, 'p1');
  assert.match(link.linkId, /^lnk_/);
  const deepLink = new URL(link.deepLinkUrl);
  assert.equal(deepLink.searchParams.get('utm_campaign'), link.subIds.utm_campaign);
  assert.equal(deepLink.searchParams.get('sid'), link.subIds.sid);

  const click = runtime.recordClick('tenant-a', {
    linkId: link.linkId,
    touchpoint: { source: 'tiktok', medium: 'video', occurredAt: '2026-08-22T04:00:00Z' }
  });
  assert.equal(click.linkId, link.linkId);
  assert.deepEqual(click.touchpoint, { source: 'tiktok', medium: 'video', occurredAt: '2026-08-22T04:00:00.000Z' });

  const conversion = runtime.recordConversion('tenant-a', {
    linkId: link.linkId,
    orderRef: 'ord-1',
    revenueMinorUnits: 25000,
    currency: 'THB'
  });
  assert.equal(conversion.orderRef, 'ord-1');
  assert.equal(conversion.revenueMinorUnits, 25000);
  assert.equal(conversion.commissionRate, 0.08);
  assert.equal(conversion.grossCommissionMinorUnits, 2000);

  const margin = runtime.computeMargin('tenant-a', {
    conversionId: conversion.conversionId,
    costMinorUnits: 450
  });
  assert.equal(margin.grossCommissionMinorUnits, 2000);
  assert.equal(margin.costMinorUnits, 450);
  assert.equal(margin.netMarginMinorUnits, 1550);
});

test('commission uses integer minor-unit math with half-up rounding from snapshot rate', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('t', { productId: 'p', platform: 'shopee', externalProductId: 'e', title: 'T' });
  const offer = runtime.publishOffer('t', { productId: 'p', price: 1000, currency: 'USD', commissionRate: 0.075 });
  const link = runtime.generateLink('t', { offerId: offer.offerId, destinationUrl: 'https://example.com/x' });
  const conversion = runtime.recordConversion('t', {
    linkId: link.linkId,
    orderRef: 'o-round',
    revenueMinorUnits: 33333,
    currency: 'USD'
  });
  assert.equal(conversion.grossCommissionMinorUnits, 2500);
  assert.equal(Number.isInteger(conversion.grossCommissionMinorUnits), true);
});

test('tenant isolation: parallel tenants never see each other state and outbox is partitioned', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('tenant-a', { productId: 'shared-sku', platform: 'tiktok', externalProductId: 'ea', title: 'A' });
  runtime.registerProduct('tenant-b', { productId: 'shared-sku', platform: 'shopee', externalProductId: 'eb', title: 'B' });

  const offerA = runtime.publishOffer('tenant-a', { productId: 'shared-sku', price: 100, currency: 'THB', commissionRate: 0.1 });
  const offerB = runtime.publishOffer('tenant-b', { productId: 'shared-sku', price: 200, currency: 'USD', commissionRate: 0.2 });
  assert.notEqual(offerA.offerId, offerB.offerId);

  const eventsA = runtime.drainOutbox('tenant-a');
  assert.equal(eventsA.length, 2);
  for (const event of eventsA) assert.equal(event.tenantId, 'tenant-a');

  const eventsB = runtime.drainOutbox('tenant-b');
  assert.equal(eventsB.length, 2);
  for (const event of eventsB) assert.equal(event.tenantId, 'tenant-b');

  assert.throws(() => runtime.publishOffer('tenant-a', { productId: 'nope', price: 1, currency: 'THB', commissionRate: 0.1 }), /not found/);
});

test('cross-tenant access denied for every accessor', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('tenant-a', { productId: 'p1', platform: 'tiktok', externalProductId: 'e', title: 'A' });
  const offer = runtime.publishOffer('tenant-a', { productId: 'p1', price: 1000, currency: 'THB', commissionRate: 0.1 });
  const link = runtime.generateLink('tenant-a', { offerId: offer.offerId, destinationUrl: 'https://a.example.com/item' });
  runtime.recordClick('tenant-a', { linkId: link.linkId, touchpoint: { source: 's', medium: 'm', occurredAt: '2026-08-22T04:00:00Z' } });
  const conversion = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'own-1', revenueMinorUnits: 5000, currency: 'THB' });

  assert.throws(
    () => runtime.publishOffer('tenant-b', { productId: 'p1', price: 100, currency: 'THB', commissionRate: 0.1 }),
    /cross_tenant_access/
  );
  assert.throws(
    () => runtime.generateLink('tenant-b', { offerId: offer.offerId, destinationUrl: 'https://b.example.com/item' }),
    /cross_tenant_access/
  );
  assert.throws(
    () => runtime.recordClick('tenant-b', { linkId: link.linkId, touchpoint: { source: 's', medium: 'm', occurredAt: '2026-08-22T04:01:00Z' } }),
    /cross_tenant_access/
  );
  assert.throws(
    () => runtime.recordConversion('tenant-b', { linkId: link.linkId, orderRef: 'stolen-order', revenueMinorUnits: 100, currency: 'THB' }),
    /cross_tenant_access/
  );
  assert.throws(
    () => runtime.computeMargin('tenant-b', { conversionId: conversion.conversionId, costMinorUnits: 10 }),
    /cross_tenant_access/
  );

  const stolenAttempt = (() => {
    try {
      runtime.recordConversion('tenant-b', { linkId: link.linkId, orderRef: 'stolen-order', revenueMinorUnits: 100, currency: 'THB' });
      return true;
    } catch {
      return false;
    }
  })();
  assert.equal(stolenAttempt, false);
});

test('conversion idempotency on (tenantId, orderRef) prevents duplicate commissions', () => {
  const auditLog = [];
  const runtime = createAffiliateRuntime({ clock: fixedClock(), auditSink: (entry) => auditLog.push(entry) });
  runtime.registerProduct('tenant-a', { productId: 'p1', platform: 'tiktok', externalProductId: 'e', title: 'A' });
  const offer = runtime.publishOffer('tenant-a', { productId: 'p1', price: 900, currency: 'THB', commissionRate: 0.1 });
  const link = runtime.generateLink('tenant-a', { offerId: offer.offerId, destinationUrl: 'https://a.example.com/item' });

  const first = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'ord-dup', revenueMinorUnits: 10000, currency: 'THB' });
  const second = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'ord-dup', revenueMinorUnits: 10000, currency: 'THB' });

  assert.equal(second, first);
  assert.equal(first.conversionId, second.conversionId);
  assert.equal(first.grossCommissionMinorUnits, 1000);

  const conversionEvents = runtime.drainOutbox('tenant-a').filter((event) => event.type === 'conversion.recorded');
  assert.equal(conversionEvents.length, 1);

  const conversionAudits = auditLog.filter((entry) => entry.action === 'conversion.recorded');
  assert.equal(conversionAudits.length, 1);
});

test('outbox ordering is monotonic per tenant and dispatch marking drains pending events transactionally', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('tenant-a', { productId: 'p1', platform: 'tiktok', externalProductId: 'e', title: 'A' });

  const custom = runtime.emitDomainEvent({ tenantId: 'tenant-a', type: 'custom.note', payload: { note: 'hello' }, occurredAt: '2026-08-22T05:00:00Z' });
  assert.equal(custom.sequence, 2);
  assert.deepEqual(custom.payload, { note: 'hello' });
  assert.equal(custom.occurredAt, '2026-08-22T05:00:00.000Z');

  const firstBatch = runtime.drainOutbox('tenant-a', { limit: 2 });
  assert.equal(firstBatch.length, 2);
  assert.deepEqual(firstBatch.map((event) => event.type), ['product.registered', 'custom.note']);
  assert.ok(firstBatch[0].sequence < firstBatch[1].sequence);
  assert.equal(firstBatch[0].tenantId, 'tenant-a');

  runtime.emitDomainEvent({ tenantId: 'tenant-a', type: 'custom.second', payload: {} });
  const remaining = runtime.drainOutbox('tenant-a');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, 'custom.second');

  assert.deepEqual(runtime.drainOutbox('tenant-a'), []);

  runtime.emitDomainEvent({ tenantId: 'tenant-b', type: 'other.tenant.event', payload: {} });
  const tenantBEvents = runtime.drainOutbox('tenant-b');
  assert.equal(tenantBEvents.length, 1);
  assert.equal(tenantBEvents[0].sequence, 1);
  assert.equal(tenantBEvents[0].type, 'other.tenant.event');

  assert.throws(() => runtime.drainOutbox('tenant-a', { limit: 0 }), /limit/);
  assert.throws(() => runtime.drainOutbox('tenant-a', { limit: -3 }), /limit/);
  assert.throws(() => runtime.emitDomainEvent({ tenantId: 'tenant-a', type: 'bad.payload', payload: [1, 2] }), /payload/);
});

test('immutable snapshots: mutating returned objects cannot change runtime state', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('tenant-a', { productId: 'p1', platform: 'tiktok', externalProductId: 'e', title: 'A' });
  const offer = runtime.publishOffer('tenant-a', { productId: 'p1', price: 5000, currency: 'THB', commissionRate: 0.08 });
  const link = runtime.generateLink('tenant-a', { offerId: offer.offerId, destinationUrl: 'https://a.example.com/item' });
  const click = runtime.recordClick('tenant-a', { linkId: link.linkId, touchpoint: { source: 's', medium: 'm', occurredAt: '2026-08-22T04:00:00Z' } });
  const conversion = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'imm-1', revenueMinorUnits: 100000, currency: 'THB' });
  const margin = runtime.computeMargin('tenant-a', { conversionId: conversion.conversionId, costMinorUnits: 100 });
  const event = runtime.emitDomainEvent({ tenantId: 'tenant-a', type: 'frozen.check', payload: { k: 'v' } });

  assert.equal(Object.isFrozen(offer), true);
  assert.equal(Object.isFrozen(link), true);
  assert.equal(Object.isFrozen(link.subIds), true);
  assert.equal(Object.isFrozen(click), true);
  assert.equal(Object.isFrozen(click.touchpoint), true);
  assert.equal(Object.isFrozen(conversion), true);
  assert.equal(Object.isFrozen(margin), true);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.payload), true);

  assert.throws(() => { offer.commissionRate = 0.99; }, TypeError);
  assert.throws(() => { offer.priceMinorUnits = 1; }, TypeError);
  assert.throws(() => { link.subIds.subid = 'tampered'; }, TypeError);
  assert.throws(() => { click.touchpoint.source = 'spoofed'; }, TypeError);
  assert.throws(() => { conversion.grossCommissionMinorUnits = 999999; }, TypeError);
  assert.throws(() => { margin.netMarginMinorUnits = 0; }, TypeError);
  assert.throws(() => { event.payload.k = 'changed'; }, TypeError);

  const replayed = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'imm-2', revenueMinorUnits: 100000, currency: 'THB' });
  assert.equal(replayed.commissionRate, 0.08);
  assert.equal(replayed.grossCommissionMinorUnits, 8000);
  assert.equal(margin.netMarginMinorUnits, conversion.grossCommissionMinorUnits - 100);
});

test('audit sink receives exactly one frozen entry per mutating action in lifecycle order', () => {
  const auditLog = [];
  const runtime = createAffiliateRuntime({ clock: fixedClock(), auditSink: (entry) => auditLog.push(entry) });

  runtime.registerProduct('tenant-a', { productId: 'p1', platform: 'tiktok', externalProductId: 'e', title: 'A' });
  const offer = runtime.publishOffer('tenant-a', { productId: 'p1', price: 700, currency: 'THB', commissionRate: 0.05 });
  const link = runtime.generateLink('tenant-a', { offerId: offer.offerId, destinationUrl: 'https://a.example.com/item' });
  const click = runtime.recordClick('tenant-a', { linkId: link.linkId, touchpoint: { source: 's', medium: 'm', occurredAt: '2026-08-22T04:00:00Z' } });
  const conversion = runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'aud-1', revenueMinorUnits: 2000, currency: 'THB' });
  runtime.computeMargin('tenant-a', { conversionId: conversion.conversionId, costMinorUnits: 50 });

  runtime.recordConversion('tenant-a', { linkId: link.linkId, orderRef: 'aud-1', revenueMinorUnits: 2000, currency: 'THB' });
  runtime.drainOutbox('tenant-a');

  assert.deepEqual(
    auditLog.map((entry) => entry.action),
    ['product.registered', 'offer.published', 'link.generated', 'click.recorded', 'conversion.recorded', 'margin.computed']
  );
  for (const entry of auditLog) {
    assert.deepEqual(Object.keys(entry).sort(), ['action', 'actor', 'occurredAt', 'resourceId', 'tenantId']);
    assert.equal(entry.tenantId, 'tenant-a');
    assert.equal(entry.actor, 'system');
    assert.ok(entry.resourceId);
    assert.ok(!Number.isNaN(new Date(entry.occurredAt).getTime()));
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(auditLog[1].resourceId, offer.offerId);
  assert.equal(auditLog[2].resourceId, link.linkId);
  assert.equal(auditLog[3].resourceId, click.clickId);
  assert.equal(auditLog[4].resourceId, conversion.conversionId);
});

test('fail-closed input validation rejects malformed monetary and URL inputs', () => {
  const runtime = createAffiliateRuntime({ clock: fixedClock() });
  runtime.registerProduct('t', { productId: 'p', platform: 'tiktok', externalProductId: 'e', title: 'T' });

  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: 10.5, currency: 'USD', commissionRate: 0.1 }), /minor units/);
  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: -1, currency: 'USD', commissionRate: 0.1 }), /minor units/);
  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: 100, currency: 'usd', commissionRate: 0.1 }), /currency/);
  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: 100, currency: 'EURO', commissionRate: 0.1 }), /currency/);
  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: 100, currency: 'USD', commissionRate: 1.5 }), /between 0 and 1/);
  assert.throws(() => runtime.publishOffer('t', { productId: 'p', price: 100, currency: 'USD', commissionRate: -0.1 }), /between 0 and 1/);

  const offer = runtime.publishOffer('t', { productId: 'p', price: 100, currency: 'USD', commissionRate: 0.5 });
  assert.throws(() => runtime.generateLink('t', { offerId: offer.offerId, destinationUrl: 'http://example.com/x' }), /HTTPS/);
  assert.throws(() => runtime.generateLink('t', { offerId: offer.offerId, destinationUrl: 'not a url' }), /valid URL/);

  const link = runtime.generateLink('t', { offerId: offer.offerId, destinationUrl: 'https://example.com/x' });
  assert.throws(() => runtime.recordClick('t', { linkId: link.linkId, touchpoint: { source: '', medium: 'm', occurredAt: '2026-08-22T04:00:00Z' } }), /source/);
  assert.throws(() => runtime.recordClick('t', { linkId: link.linkId, touchpoint: { source: 's', medium: 'm', occurredAt: 'yesterday-ish' } }), /timestamp/);
  assert.throws(() => runtime.recordConversion('t', { linkId: link.linkId, orderRef: 'o', revenueMinorUnits: 99.9, currency: 'USD' }), /minor units/);
  assert.throws(() => runtime.recordConversion('t', { linkId: link.linkId, orderRef: 'o', revenueMinorUnits: -5, currency: 'USD' }), /minor units/);

  const conversion = runtime.recordConversion('t', { linkId: link.linkId, orderRef: 'ok', revenueMinorUnits: 100, currency: 'USD' });
  assert.throws(() => runtime.computeMargin('t', { conversionId: conversion.conversionId, costMinorUnits: -5 }), /minor units/);
  assert.throws(() => runtime.computeMargin('t', { conversionId: conversion.conversionId, costMinorUnits: 1.25 }), /minor units/);

  assert.throws(() => runtime.registerProduct('', {}), /tenantId/);
});
