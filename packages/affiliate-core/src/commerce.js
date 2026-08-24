import { randomUUID } from 'node:crypto';

export const INVENTORY_STATUSES = new Set(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'UNKNOWN']);
const PURCHASABLE_STATUSES = new Set(['IN_STOCK', 'LOW_STOCK', 'PREORDER']);

export const PROMOTION_TYPES = new Set([
  'PRICE_DROP', 'PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'COUPON', 'VOUCHER', 'BUNDLE',
  'FREE_SHIPPING', 'FLASH_SALE', 'CAMPAIGN_SALE', 'PROVIDER_PROMOTION', 'OTHER'
]);

export const PROMOTION_STATUSES = new Set(['UPCOMING', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'CANCELLED', 'UNKNOWN']);

export const DEFAULT_FRESHNESS = new Map([
  ['price', 30 * 60 * 1000],
  ['inventory', 10 * 60 * 1000],
  ['coupon', 30 * 60 * 1000],
  ['commission', 6 * 60 * 60 * 1000],
  ['promotion', 30 * 60 * 1000]
]);

function mint(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function minorUnits(value, label, { required = false } = {}) {
  if (value == null) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer in minor units`);
  return value;
}

function iso(value, label) {
  const date = new Date(value ?? '');
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

export function createCommerceStore({ clock = () => Date.now(), freshnessThresholds = null } = {}) {
  const thresholds = new Map(freshnessThresholds ?? DEFAULT_FRESHNESS);
  for (const [claimType, ms] of thresholds) {
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`freshness threshold for ${claimType} must be positive`);
  }
  const partitions = new Map();

  function partition(tenantId) {
    const id = requireText(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = { offers: new Map(), snapshots: new Map(), promotions: new Map() };
      partitions.set(id, scope);
    }
    return scope;
  }

  function owned(scope, tenantId, kind, id) {
    const record = scope[kind].get(id);
    if (record) return record;
    for (const candidate of partitions.values()) {
      if (candidate !== scope && candidate[kind].has(id)) {
        throw new Error('cross_tenant_access');
      }
    }
    return null;
  }

  function upsertOffer(tenantId, input) {
    const scope = partition(tenantId);
    const providerOfferId = requireText(input.providerOfferId, 'providerOfferId');
    const existingByProvider = [...scope.offers.values()].find((offer) => offer.providerOfferId === providerOfferId);
    if (existingByProvider) {
      return updateOfferRecord(scope, existingByProvider.offerId, input);
    }
    const offerId = input.offerId == null ? mint('off') : requireText(input.offerId, 'offerId');
    return buildOfferRecord(scope, offerId, input);
  }

  function validatePricing(input) {
    const listPrice = minorUnits(input.listPriceMinorUnits, 'listPriceMinorUnits');
    const salePrice = minorUnits(input.salePriceMinorUnits, 'salePriceMinorUnits');
    if (listPrice == null && salePrice == null) throw new Error('at least one price is required');
    if (salePrice != null && listPrice != null && salePrice > listPrice) {
      throw new Error('sale price above list price is unexpected without promotion context');
    }
    return { listPrice, salePrice };
  }

  function buildOfferRecord(scope, offerId, input) {
    const inventoryStatus = requireText(input.inventoryStatus, 'inventoryStatus').toUpperCase();
    if (!INVENTORY_STATUSES.has(inventoryStatus)) throw new Error(`unsupported inventory status: ${input.inventoryStatus}`);
    const { listPrice, salePrice } = validatePricing(input);
    const commissionRate = input.commissionRate == null
      ? null
      : ((value) => {
        const rate = Number(value);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('commissionRate must be between 0 and 1');
        return rate;
      })(input.commissionRate);

    const verifiedAt = iso(input.verifiedAt ?? clock(), 'verifiedAt');
    const record = Object.freeze({
      offerId,
      provider: requireText(input.provider, 'provider').toLowerCase(),
      providerOfferId: String(input.providerOfferId).trim(),
      merchantId: requireText(input.merchantId, 'merchantId'),
      productId: requireText(input.productId, 'productId'),
      variantId: input.variantId == null ? null : requireText(input.variantId, 'variantId'),
      currency: requireText(input.currency, 'currency').toUpperCase(),
      listPriceMinorUnits: listPrice,
      salePriceMinorUnits: salePrice,
      effectivePriceMinorUnits: salePrice ?? listPrice,
      inventoryStatus,
      purchasable: PURCHASABLE_STATUSES.has(inventoryStatus),
      commissionRate,
      commissionAmountMinorUnits: minorUnits(input.commissionAmountMinorUnits, 'commissionAmountMinorUnits'),
      startsAt: input.startsAt == null ? null : iso(input.startsAt, 'startsAt'),
      endsAt: input.endsAt == null ? null : iso(input.endsAt, 'endsAt'),
      source: requireText(input.source ?? 'unknown', 'source'),
      verifiedAt,
      createdAt: iso(clock(), 'clock')
    });
    scope.offers.set(offerId, record);
    return record;
  }

  function updateOfferRecord(scope, offerId, input) {
    scope.offers.delete(offerId);
    return buildOfferRecord.call(null, scope, offerId, input);
  }

  function getOffer(tenantId, offerId) {
    const scope = partition(tenantId);
    try {
      return owned(scope, tenantId, 'offers', requireText(offerId, 'offerId'));
    } catch (error) {
      if (/cross_tenant/.test(error.message)) return null;
      throw error;
    }
  }

  function recordPriceSnapshot(tenantId, offerId, { listPriceMinorUnits = null, salePriceMinorUnits = null, observedAt, source }) {
    const scope = partition(tenantId);
    const offer = owned(scope, tenantId, 'offers', requireText(offerId, 'offerId'));
    if (!offer) throw new Error(`offer ${offerId} not found`);
    const snapshot = Object.freeze({
      snapshotId: mint('prs'),
      offerId,
      listPriceMinorUnits: listPriceMinorUnits == null ? offer.listPriceMinorUnits : minorUnits(listPriceMinorUnits, 'listPriceMinorUnits'),
      salePriceMinorUnits: salePriceMinorUnits == null ? offer.salePriceMinorUnits : minorUnits(salePriceMinorUnits, 'salePriceMinorUnits'),
      currency: offer.currency,
      observedAt: iso(observedAt, 'observedAt'),
      source: requireText(source ?? 'unknown', 'source')
    });
    const history = scope.snapshots.get(offerId) ?? [];
    history.push(snapshot);
    scope.snapshots.set(offerId, history);
    return snapshot;
  }

  function listPriceSnapshots(tenantId, offerId) {
    const scope = partition(tenantId);
    const history = owned(scope, tenantId, 'snapshots', requireText(offerId, 'offerId'));
    if (!history) throw new Error(`no snapshots found for offer ${offerId}`);
    return Object.freeze([...history]);
  }

  function upsertPromotion(tenantId, input) {
    const scope = partition(tenantId);
    const type = requireText(input.type, 'type').toUpperCase();
    if (!PROMOTION_TYPES.has(type)) throw new Error(`unsupported promotion type: ${input.type}`);
    const startsAt = iso(input.startsAt, 'startsAt');
    const endsAt = iso(input.endsAt, 'endsAt');
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new Error('ends_at must be after starts_at');
    const verified = input.verified !== false;
    const nowIso = iso(clock(), 'clock');
    const status = !verified ? 'UNKNOWN' : resolvePromotionStatus(startsAt, endsAt, nowIso);
    const record = Object.freeze({
      promotionId: mint('prm'),
      type,
      offerId: requireText(input.offerId, 'offerId'),
      startsAt,
      endsAt,
      verifiedAt: verified ? nowIso : null,
      source: input.source == null ? null : String(input.source).trim(),
      status,
      createdAt: nowIso
    });
    scope.promotions.set(record.promotionId, record);
    return record;
  }

  function resolvePromotionStatus(startsAt, endsAt, nowMs) {
    const start = new Date(startsAt).getTime();
    const end = new Date(endsAt).getTime();
    const current = typeof nowMs === 'number' ? nowMs : new Date(nowMs).getTime();
    if (current < start) return 'UPCOMING';
    if (current >= end) return 'EXPIRED';
    const windowMs = Math.max(1, end - start);
    if (end - current <= windowMs * 0.1) return 'EXPIRING';
    return 'ACTIVE';
  }

  function promotionStatus(tenantId, promotionId, nowOverride = null) {
    const scope = partition(tenantId);
    const promotion = owned(scope, tenantId, 'promotions', requireText(promotionId, 'promotionId'));
    if (!promotion) throw new Error(`promotion ${promotionId} not found`);
    if (promotion.status === 'CANCELLED' || promotion.status === 'UNKNOWN') return Object.freeze({ status: promotion.status });
    const nowMs = nowOverride == null ? clock() : new Date(nowOverride).getTime();
    return Object.freeze({ status: resolvePromotionStatus(promotion.startsAt, promotion.endsAt, nowMs), endsAt: promotion.endsAt });
  }

  function isFresh({ verifiedAt, claimType }) {
    const threshold = thresholds.get(requireText(claimType, 'claimType'));
    if (threshold == null) throw new Error(`no freshness threshold configured for claim type: ${claimType}`);
    const age = clock() - new Date(iso(verifiedAt, 'verifiedAt')).getTime();
    return age >= 0 && age <= threshold;
  }

  function revalidateCommercialClaim(tenantId, { offerId, claim, scheduledFor = null, nowOverride = null }) {
      const scope = partition(tenantId);
      const offer = getOffer(tenantId, offerId);
      if (!offer) throw new Error(`offer ${offerId} not found`);

      if (claim.promotionId) {
        const effectiveNow = nowOverride ?? new Date(clock()).toISOString();
        const status = promotionStatus(tenantId, claim.promotionId, effectiveNow);
        if (status.status === 'EXPIRED' || status.status === 'CANCELLED' || status.status === 'UNKNOWN') {
          return block('promotion_expired', `promotion ${claim.promotionId} is ${status.status}`, ['cancel_publication', 'request_review']);
        }
      }

      if (claim.type === 'PRICE' || claim.type === 'DISCOUNT') {
        const fresh = isFreshFor(offer.verifiedAt, 'price', nowOverride);
        if (!fresh) {
          return block('stale_evidence', `price evidence older than configured freshness window`, ['refresh_offer', 'block_publication']);
        }
        const latest = latestSnapshotPrice(scope, offerId) ?? offer.effectivePriceMinorUnits;
        if (claim.type === 'PRICE' && claim.salePriceMinorUnits != null && claim.salePriceMinorUnits !== latest) {
          return block('stale_price', `claimed price ${claim.salePriceMinorUnits} no longer matches provider price ${latest}`, ['regenerate', 'remove_dynamic_claim']);
        }
        if (claim.type === 'DISCOUNT' && claim.percentOff != null) {
          const actualPercent = computeDiscountPercent(offer.listPriceMinorUnits, latest);
          if (actualPercent == null || Math.abs(actualPercent - claim.percentOff) > 1) {
            return block('stale_price', `claimed discount ${claim.percentOff}% does not match verified ${actualPercent ?? 'unknown'}%`, ['regenerate', 'remove_dynamic_claim']);
          }
        }
      }

      return Object.freeze({
        decision: 'ALLOW',
        reason: 'commercial claims match verified evidence within freshness windows',
        evidence: Object.freeze({
          percentOff: claim.percentOff != null ? computeDiscountPercent(offer.listPriceMinorUnits, latestKnownPrice(scope, offerId)) : undefined,
          priceMinorUnits: latestKnownPrice(scope, offerId),
          verifiedAt: offer.verifiedAt
        }),
        dryRunFields: { scheduledFor: scheduledFor ?? null }
      });
  }

  function isFreshFor(verifiedAt, claimType, nowOverride) {
    if (nowOverride != null) {
      const threshold = thresholds.get(claimType);
      const age = new Date(nowOverride).getTime() - new Date(verifiedAt).getTime();
      return age >= 0 && age <= threshold;
    }
    return isFresh({ verifiedAt, claimType });
  }

  function latestSnapshotPrice(scope, offerId) {
    const history = scope.snapshots.get(offerId);
    if (!history || history.length === 0) return null;
    return history[history.length - 1].salePriceMinorUnits ?? history[history.length - 1].listPriceMinorUnits;
  }

  function latestKnownPrice(scope, offerId) {
    return latestSnapshotPrice(scope, offerId) ?? scope.offers.get(offerId)?.effectivePriceMinorUnits ?? null;
  }

  function computeDiscountPercent(listPrice, salePrice) {
    if (listPrice == null || salePrice == null || listPrice === 0) return null;
    return Math.round(((listPrice - salePrice) / listPrice) * 100);
  }

  function block(reason, message, actions) {
    return Object.freeze({
      decision: 'BLOCK',
      reason,
      message,
      actions: Object.freeze([...actions])
    });
  }

  function size(tenantId) {
    const scope = partitions.get(tenantId);
    if (!scope) return 0;
    return scope.offers.size + scope.promotions.size + [...scope.snapshots.values()].flat().length;
  }

  return Object.freeze({
    upsertOffer,
    getOffer,
    recordPriceSnapshot,
    listPriceSnapshots,
    upsertPromotion,
    promotionStatus,
    isFresh,
    revalidateCommercialClaim,
    size,
    partitions
  });
}
