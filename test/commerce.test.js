import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_STATUSES,
  PROMOTION_TYPES,
  PROMOTION_STATUSES,
  DEFAULT_FRESHNESS,
  createCommerceStore
} from '../packages/affiliate-core/src/commerce.js';

const NOW = new Date('2026-08-24T10:00:00.000Z').getTime();
const TENANT = 'org-A';

function store() {
  return createCommerceStore({ clock: () => NOW });
}

function offerInput(overrides = {}) {
  return {
    provider: 'tiktok',
    providerOfferId: 'prov-offer-1',
    merchantId: 'mrc_1',
    productId: 'prod_1',
    currency: 'THB',
    listPriceMinorUnits: 100000,
    salePriceMinorUnits: 80000,
    inventoryStatus: 'IN_STOCK',
    source: 'provider-catalog-sync',
    ...overrides
  };
}

test('inventory statuses and promotion types are the canonical frozen sets', () => {
  assert.deepEqual([...INVENTORY_STATUSES].sort(), ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'UNKNOWN']);
  assert.ok(PROMOTION_TYPES.has('FLASH_SALE'));
  assert.ok(PROMOTION_TYPES.has('PROVIDER_PROMOTION'));
  assert.ok(PROMOTION_STATUSES.has('UNKNOWN'));
});

test('offers require provider identity and non-negative consistent pricing', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput());
  assert.ok(offer.offerId.startsWith('off_'));
  assert.equal(offer.effectivePriceMinorUnits, 80000);
  assert.throws(() => s.upsertOffer(TENANT, offerInput({ salePriceMinorUnits: null, listPriceMinorUnits: null })), /at least one price/i);
  assert.throws(() => s.upsertOffer(TENANT, offerInput({ salePriceMinorUnits: 120000 })), /sale price.*list price/i);
  assert.throws(() => s.upsertOffer(TENANT, offerInput({ inventoryStatus: 'PLENTY' })), /unsupported inventory status/i);
});

test('UNKNOWN inventory is never treated as purchasable', () => {
  const s = store();
  const unknown = s.upsertOffer(TENANT, offerInput({ inventoryStatus: 'UNKNOWN' }));
  const out = s.upsertOffer(TENANT, offerInput({ providerOfferId: 'prov-offer-2', inventoryStatus: 'OUT_OF_STOCK' }));
  assert.equal(unknown.purchasable, false);
  assert.equal(out.purchasable, false);
});

test('price snapshots are append-only chronological evidence', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput());
  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 80000, observedAt: '2026-08-24T09:00:00.000Z', source: 'sync' });
  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 85000, observedAt: '2026-08-24T09:45:00.000Z', source: 'sync' });
  const snapshots = s.listPriceSnapshots(TENANT, offer.offerId);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(snapshots.map((snap) => snap.salePriceMinorUnits), [80000, 85000]);
  assert.throws(() => { snapshots[0].salePriceMinorUnits = 1; }, TypeError);
});

test('promotions validate their type and carry explicit validity windows', () => {
  const s = store();
  const promotion = s.upsertPromotion(TENANT, {
    type: 'FLASH_SALE',
    offerId: 'off_x',
    startsAt: '2026-08-24T00:00:00.000Z',
    endsAt: '2026-08-24T20:00:00.000Z',
    source: 'provider-promotion-feed'
  });
  assert.ok(promotion.promotionId.startsWith('prm_'));
  assert.equal(promotion.status, 'ACTIVE');
  assert.throws(() => s.upsertPromotion(TENANT, { type: 'MYSTERY_DEAL', offerId: 'off_x', startsAt: NOW, endsAt: NOW + 1000 }), /unsupported promotion type/i);
  assert.throws(() => s.upsertPromotion(TENANT, { type: 'COUPON', offerId: 'off_x', startsAt: '2026-08-25T00:00:00.000Z', endsAt: '2026-08-24T00:00:00.000Z' }), /ends_at.*starts_at/i);
});

test('promotion lifecycle resolves through the clock and UNKNOWN is never active', () => {
  const s = store();
  const promotion = s.upsertPromotion(TENANT, {
    type: 'PERCENT_DISCOUNT',
    offerId: 'off_x',
    startsAt: '2026-08-24T09:00:00.000Z',
    endsAt: '2026-08-24T11:00:00.000Z'
  });
  assert.equal(s.promotionStatus(TENANT, promotion.promotionId).status, 'ACTIVE');
  assert.equal(s.promotionStatus(TENANT, promotion.promotionId, '2026-08-24T10:58:30.000Z').status, 'EXPIRING');
  assert.equal(s.promotionStatus(TENANT, promotion.promotionId, '2026-08-24T12:00:00.000Z').status, 'EXPIRED');
  assert.equal(s.promotionStatus(TENANT, promotion.promotionId, '2026-08-24T08:30:00.000Z').status, 'UPCOMING');
  const unverified = s.upsertPromotion(TENANT, { type: 'OTHER', offerId: 'off_y', startsAt: '2026-08-24T00:00:00.000Z', endsAt: '2026-08-25T00:00:00.000Z', source: null, verified: false });
  assert.equal(unverified.status, 'UNKNOWN');
});

test('freshness thresholds are configurable per claim type with safe defaults', () => {
  assert.equal(DEFAULT_FRESHNESS.get('price'), 30 * 60 * 1000);
  assert.equal(DEFAULT_FRESHNESS.get('commission'), 6 * 60 * 60 * 1000);
  const s = store();
  assert.equal(s.isFresh({ verifiedAt: new Date(NOW - 10 * 60 * 1000).toISOString(), claimType: 'price' }), true);
  assert.equal(s.isFresh({ verifiedAt: new Date(NOW - 45 * 60 * 1000).toISOString(), claimType: 'price' }), false);
  assert.equal(s.isFresh({ verifiedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(), claimType: 'commission' }), true);
});

test('commercial revalidation allows fresh matching claims and blocks stale prices', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput({ verifiedAt: new Date(NOW - 5 * 60 * 1000).toISOString() }));
  const allowed = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'PRICE', displayValue: '฿800', salePriceMinorUnits: 80000 }
  });
  assert.equal(allowed.decision, 'ALLOW');

  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 85000, observedAt: new Date(NOW - 2 * 60 * 1000).toISOString(), source: 'sync' });
  const blocked = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'PRICE', displayValue: '฿800', salePriceMinorUnits: 80000 }
  });
  assert.equal(blocked.decision, 'BLOCK');
  assert.match(blocked.reason, /stale_price/i);

  const staleEvidence = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'PRICE', displayValue: '฿850', salePriceMinorUnits: 85000 }
  });
  assert.equal(staleEvidence.decision, 'ALLOW');
});

test('expired promotion bindings block publishing paths', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput({ verifiedAt: new Date(NOW - 5 * 60 * 1000).toISOString() }));
  const promotion = s.upsertPromotion(TENANT, {
    type: 'FLASH_SALE',
    offerId: offer.offerId,
    startsAt: '2026-08-24T08:00:00.000Z',
    endsAt: '2026-08-24T09:00:00.000Z'
  });
  const blocked = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'PROMOTION', displayValue: 'Flash sale today!', promotionId: promotion.promotionId },
    nowOverride: new Date('2026-08-24T09:30:00.000Z').toISOString()
  });
  assert.equal(blocked.decision, 'BLOCK');
  assert.match(blocked.reason, /promotion_expired/i);
});

test('golden commercial scenario: 20% discount claim survives until the price moves', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput({
    verifiedAt: new Date(NOW - 5 * 60 * 1000).toISOString()
  }));
  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 80000, observedAt: new Date(NOW - 5 * 60 * 1000).toISOString(), source: 'sync' });

  const beforeExpiry = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'DISCOUNT', displayValue: 'ลด 20%', percentOff: 20 },
    scheduledFor: '2026-08-24T19:30:00.000Z'
  });
  assert.equal(beforeExpiry.decision, 'ALLOW');
  assert.equal(beforeExpiry.evidence.percentOff, 20);

  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 85000, observedAt: new Date(NOW - 1 * 60 * 1000).toISOString(), source: 'sync' });
  const afterChange = s.revalidateCommercialClaim(TENANT, {
    offerId: offer.offerId,
    claim: { type: 'DISCOUNT', displayValue: 'ลด 20%', percentOff: 20 },
    scheduledFor: '2026-08-24T19:30:00.000Z'
  });
  assert.equal(afterChange.decision, 'BLOCK');
  assert.match(afterChange.reason, /stale_price/i);
  assert.deepEqual([...afterChange.actions].sort(), ['regenerate', 'remove_dynamic_claim'].sort());
});

test('cross-tenant offer access is denied and partitions stay isolated', () => {
  const s = store();
  const offer = s.upsertOffer(TENANT, offerInput());
  s.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 80000, observedAt: '2026-08-24T09:00:00.000Z', source: 'sync' });
  assert.equal(s.getOffer('org-B', offer.offerId), null);
  assert.equal(s.size('org-A'), 2); // offer + snapshot artifact
  assert.equal(s.size('org-B'), 0);
  assert.throws(() => s.listPriceSnapshots('org-B', offer.offerId), /cross_tenant_access/i);
});
