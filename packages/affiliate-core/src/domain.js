function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function nonNegativeNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

export function createProduct({ tenantId, productId, platform, externalProductId, title, currency = 'THB' }) {
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    productId: required(productId, 'productId'),
    platform: required(platform, 'platform').toLowerCase(),
    externalProductId: required(externalProductId, 'externalProductId'),
    title: required(title, 'title'),
    currency: required(currency, 'currency').toUpperCase()
  });
}

export function createOffer({ tenantId, offerId, product, salePrice, commissionRate, cost = 0 }) {
  if (!product || product.tenantId !== tenantId) throw new Error('product tenant mismatch');
  const price = nonNegativeNumber(salePrice, 'salePrice');
  const rate = Number(commissionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('commissionRate must be between 0 and 1');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    offerId: required(offerId, 'offerId'),
    productId: product.productId,
    platform: product.platform,
    salePrice: price,
    commissionRate: rate,
    cost: nonNegativeNumber(cost, 'cost'),
    currency: product.currency
  });
}

export function createAffiliateLink({ tenantId, linkId, offer, url, subId = null }) {
  if (!offer || offer.tenantId !== tenantId) throw new Error('offer tenant mismatch');
  const parsed = new URL(required(url, 'url'));
  if (parsed.protocol !== 'https:') throw new Error('affiliate link must use HTTPS');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    linkId: required(linkId, 'linkId'),
    offerId: offer.offerId,
    productId: offer.productId,
    platform: offer.platform,
    url: parsed.toString(),
    subId: subId == null ? null : String(subId)
  });
}

export function createAttributionTouchpoint({ tenantId, touchpointId, link, type, occurredAt, metadata = {} }) {
  if (!link || link.tenantId !== tenantId) throw new Error('link tenant mismatch');
  const supported = ['impression','click','cart'];
  const normalizedType = required(type, 'type').toLowerCase();
  if (!supported.includes(normalizedType)) throw new Error('unsupported attribution touchpoint type');
  const timestamp = new Date(required(occurredAt, 'occurredAt'));
  if (Number.isNaN(timestamp.getTime())) throw new Error('occurredAt must be a valid timestamp');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    touchpointId: required(touchpointId, 'touchpointId'),
    linkId: link.linkId,
    offerId: link.offerId,
    productId: link.productId,
    platform: link.platform,
    subId: link.subId,
    type: normalizedType,
    occurredAt: timestamp.toISOString(),
    metadata: Object.freeze({ ...metadata })
  });
}

export function createConversion({ tenantId, conversionId, offer, link, grossRevenue, externalOrderId, occurredAt }) {
  if (!offer || offer.tenantId !== tenantId) throw new Error('offer tenant mismatch');
  if (!link || link.tenantId !== tenantId || link.offerId !== offer.offerId) throw new Error('link/offer mismatch');
  const timestamp = new Date(required(occurredAt, 'occurredAt'));
  if (Number.isNaN(timestamp.getTime())) throw new Error('occurredAt must be a valid timestamp');
  const revenue = nonNegativeNumber(grossRevenue, 'grossRevenue');
  const commission = revenue * offer.commissionRate;
  const margin = commission - offer.cost;
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    conversionId: required(conversionId, 'conversionId'),
    externalOrderId: required(externalOrderId, 'externalOrderId'),
    offerId: offer.offerId,
    linkId: link.linkId,
    productId: offer.productId,
    platform: offer.platform,
    subId: link.subId,
    grossRevenue: revenue,
    commission,
    cost: offer.cost,
    trueMargin: margin,
    currency: offer.currency,
    occurredAt: timestamp.toISOString()
  });
}
