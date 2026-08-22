import test from 'node:test';
import assert from 'node:assert/strict';
import { createProduct, createOffer, createAffiliateLink, createAttributionTouchpoint, createConversion } from '../packages/affiliate-core/src/domain.js';

function fixture() {
  const product = createProduct({ tenantId: 'tenant-a', productId: 'p1', platform: 'tiktok', externalProductId: 'ext-1', title: 'Demo' });
  const offer = createOffer({ tenantId: 'tenant-a', offerId: 'o1', product, salePrice: 1000, commissionRate: 0.1, cost: 20 });
  const link = createAffiliateLink({ tenantId: 'tenant-a', linkId: 'l1', offer, url: 'https://example.com/item?x=1', subId: 'campaign-1' });
  return { product, offer, link };
}

test('affiliate lifecycle computes commission and true margin', () => {
  const { offer, link } = fixture();
  const click = createAttributionTouchpoint({ tenantId: 'tenant-a', touchpointId: 't1', link, type: 'click', occurredAt: '2026-08-22T04:00:00Z' });
  assert.equal(click.subId, 'campaign-1');
  const conversion = createConversion({ tenantId: 'tenant-a', conversionId: 'c1', offer, link, grossRevenue: 1000, externalOrderId: 'order-1', occurredAt: '2026-08-22T04:05:00Z' });
  assert.equal(conversion.commission, 100);
  assert.equal(conversion.trueMargin, 80);
  assert.equal(conversion.currency, 'THB');
});

test('cross-tenant composition is rejected', () => {
  const { product, offer, link } = fixture();
  assert.throws(() => createOffer({ tenantId: 'tenant-b', offerId: 'x', product, salePrice: 10, commissionRate: 0.1 }), /tenant mismatch/);
  assert.throws(() => createAffiliateLink({ tenantId: 'tenant-b', linkId: 'x', offer, url: 'https://example.com' }), /tenant mismatch/);
  assert.throws(() => createAttributionTouchpoint({ tenantId: 'tenant-b', touchpointId: 'x', link, type: 'click', occurredAt: '2026-08-22T04:00:00Z' }), /tenant mismatch/);
});

test('affiliate links reject insecure URLs', () => {
  const { offer } = fixture();
  assert.throws(() => createAffiliateLink({ tenantId: 'tenant-a', linkId: 'bad', offer, url: 'http://example.com' }), /HTTPS/);
});

test('commission rate is bounded', () => {
  const product = createProduct({ tenantId: 'tenant-a', productId: 'p1', platform: 'tiktok', externalProductId: 'ext-1', title: 'Demo' });
  assert.throws(() => createOffer({ tenantId: 'tenant-a', offerId: 'bad', product, salePrice: 10, commissionRate: 1.1 }), /between 0 and 1/);
});
