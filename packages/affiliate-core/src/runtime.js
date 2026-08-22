import { randomBytes } from 'node:crypto';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SYSTEM_ACTOR = 'system';
const HTTPS_PROTOCOL = 'https:';

function text(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function isoCurrency(value, name = 'currency') {
  const normalized = String(value ?? '').trim();
  if (!CURRENCY_PATTERN.test(normalized)) throw new Error(`${name} must be a 3-letter ISO currency code`);
  return normalized;
}

function minorUnits(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer amount in minor units`);
  }
  return value;
}

function commissionRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('commissionRate must be between 0 and 1');
  return rate;
}

function requiredTimestamp(value, name) {
  if (value == null) throw new Error(`${name} is required`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function commissionFrom(revenueMinorUnits, rate) {
  const basisPoints = Math.round(rate * 10000);
  const scaled = BigInt(revenueMinorUnits) * BigInt(basisPoints) + 5000n;
  return Number(scaled / 10000n);
}

function token() {
  return randomBytes(12).toString('base64url');
}

function mint(prefix) {
  return `${prefix}_${token()}`;
}

export function createAffiliateRuntime({ clock = () => Date.now(), auditSink = null } = {}) {
  if (typeof clock !== 'function') throw new Error('clock must be a function');
  if (auditSink != null && typeof auditSink !== 'function') throw new Error('auditSink must be a function');

  const partitions = new Map();
  const KIND_LABELS = Object.freeze({
    products: 'product',
    offers: 'offer',
    links: 'link',
    clicks: 'click',
    conversions: 'conversion',
    margins: 'margin'
  });

  function nowIso() {
    return new Date(clock()).toISOString();
  }

  function partition(tenantId) {
    const id = text(tenantId, 'tenantId');
    let scope = partitions.get(id);
    if (!scope) {
      scope = {
        products: new Map(),
        offers: new Map(),
        links: new Map(),
        clicks: new Map(),
        conversions: new Map(),
        margins: new Map(),
        orders: new Map(),
        outbox: [],
        sequence: 0
      };
      partitions.set(id, scope);
    }
    return scope;
  }

  function owned(scope, tenantId, kind, id) {
    const key = text(id, `${KIND_LABELS[kind]}Id`);
    const record = scope[kind].get(key);
    if (record) return record;
    for (const candidateScope of partitions.values()) {
      if (candidateScope !== scope && candidateScope[kind].has(key)) {
        throw new Error('cross_tenant_access');
      }
    }
    throw new Error(`${KIND_LABELS[kind]} ${key} not found`);
  }

  function audit(action, tenantId, resourceId) {
    if (!auditSink) return;
    auditSink(Object.freeze({
      tenantId,
      actor: SYSTEM_ACTOR,
      action,
      resourceId,
      occurredAt: nowIso()
    }));
  }

  function appendEvent(scope, tenantId, type, payload, occurredAt) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('payload must be an object');
    }
    scope.sequence += 1;
    const event = Object.freeze({
      sequence: scope.sequence,
      type: text(type, 'type'),
      payload: Object.freeze({ ...payload }),
      occurredAt,
      tenantId
    });
    scope.outbox.push({ event, dispatched: false });
    return event;
  }

  function registerProduct(tenantId, product) {
    const id = text(tenantId, 'tenantId');
    if (!product || typeof product !== 'object') throw new TypeError('product is required');
    const scope = partition(id);
    const productId = product.productId == null ? mint('prod') : text(product.productId, 'productId');
    if (scope.products.has(productId)) throw new Error(`product ${productId} already exists`);
    const occurredAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      productId,
      platform: text(product.platform, 'platform').toLowerCase(),
      externalProductId: text(product.externalProductId, 'externalProductId'),
      title: text(product.title, 'title'),
      currency: isoCurrency(product.currency ?? 'THB'),
      createdAt: occurredAt
    });
    scope.products.set(productId, record);
    appendEvent(scope, id, 'product.registered', { productId }, occurredAt);
    audit('product.registered', id, productId);
    return record;
  }

  function publishOffer(tenantId, input) {
    const id = text(tenantId, 'tenantId');
    if (!input || typeof input !== 'object') throw new TypeError('offer input is required');
    const scope = partition(id);
    const product = owned(scope, id, 'products', input.productId);
    const priceMinorUnits = minorUnits(input.price, 'price');
    const currency = isoCurrency(input.currency);
    const rate = commissionRate(input.commissionRate);
    const offerId = mint('off');
    const capturedAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      offerId,
      productId: product.productId,
      priceMinorUnits,
      currency,
      commissionRate: rate,
      capturedAt,
      createdAt: capturedAt
    });
    scope.offers.set(offerId, record);
    appendEvent(scope, id, 'offer.published', { offerId, productId: product.productId, priceMinorUnits, currency }, capturedAt);
    audit('offer.published', id, offerId);
    return record;
  }

  function generateLink(tenantId, input) {
    const id = text(tenantId, 'tenantId');
    if (!input || typeof input !== 'object') throw new TypeError('link input is required');
    const scope = partition(id);
    const offer = owned(scope, id, 'offers', input.offerId);
    const rawUrl = text(input.destinationUrl, 'destinationUrl');
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('destinationUrl must be a valid URL');
    }
    if (parsed.protocol !== HTTPS_PROTOCOL) throw new Error('affiliate link must use HTTPS');
    const requested = input.subIds ?? ['subid'];
    let names;
    let provided;
    if (Array.isArray(requested)) {
      names = requested.map((entry, index) => text(entry, `subIds[${index}]`));
      provided = {};
    } else if (requested && typeof requested === 'object') {
      names = Object.keys(requested);
      provided = requested;
    } else {
      throw new Error('subIds must be an array of parameter names or an object');
    }
    if (names.length === 0) throw new Error('subIds must not be empty');
    const subIds = {};
    for (const name of names) {
      const key = text(name, 'subIds name');
      const value = provided[key];
      const normalized = value == null ? '' : String(value).trim();
      subIds[key] = normalized || token();
    }
    const deepLink = new URL(parsed.toString());
    for (const [name, value] of Object.entries(subIds)) {
      deepLink.searchParams.set(name, value);
    }
    const linkId = mint('lnk');
    const occurredAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      linkId,
      offerId: offer.offerId,
      productId: offer.productId,
      destinationUrl: parsed.toString(),
      deepLinkUrl: deepLink.toString(),
      subIds: Object.freeze(subIds),
      createdAt: occurredAt
    });
    scope.links.set(linkId, record);
    appendEvent(scope, id, 'link.generated', { linkId, offerId: offer.offerId }, occurredAt);
    audit('link.generated', id, linkId);
    return record;
  }

  function recordClick(tenantId, input) {
    const id = text(tenantId, 'tenantId');
    if (!input || typeof input !== 'object') throw new TypeError('click input is required');
    const scope = partition(id);
    const link = owned(scope, id, 'links', input.linkId);
    const touchpointInput = input.touchpoint;
    if (!touchpointInput || typeof touchpointInput !== 'object') throw new TypeError('touchpoint is required');
    const touchpoint = Object.freeze({
      source: text(touchpointInput.source, 'source'),
      medium: text(touchpointInput.medium, 'medium'),
      occurredAt: requiredTimestamp(touchpointInput.occurredAt, 'occurredAt')
    });
    const clickId = mint('clk');
    const occurredAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      clickId,
      linkId: link.linkId,
      offerId: link.offerId,
      productId: link.productId,
      subIds: link.subIds,
      touchpoint,
      recordedAt: occurredAt
    });
    scope.clicks.set(clickId, record);
    appendEvent(scope, id, 'click.recorded', { clickId, linkId: link.linkId }, occurredAt);
    audit('click.recorded', id, clickId);
    return record;
  }

  function recordConversion(tenantId, input) {
    const id = text(tenantId, 'tenantId');
    if (!input || typeof input !== 'object') throw new TypeError('conversion input is required');
    const scope = partition(id);
    const link = owned(scope, id, 'links', input.linkId);
    const orderRef = text(input.orderRef, 'orderRef');
    const existingId = scope.orders.get(orderRef);
    if (existingId) return scope.conversions.get(existingId);
    const revenueMinorUnits = minorUnits(input.revenueMinorUnits, 'revenueMinorUnits');
    const currency = isoCurrency(input.currency);
    const offer = owned(scope, id, 'offers', link.offerId);
    const grossCommissionMinorUnits = commissionFrom(revenueMinorUnits, offer.commissionRate);
    const conversionId = mint('cnv');
    const occurredAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      conversionId,
      linkId: link.linkId,
      offerId: offer.offerId,
      productId: link.productId,
      orderRef,
      revenueMinorUnits,
      currency,
      commissionRate: offer.commissionRate,
      grossCommissionMinorUnits,
      occurredAt
    });
    scope.orders.set(orderRef, conversionId);
    scope.conversions.set(conversionId, record);
    appendEvent(scope, id, 'conversion.recorded', { conversionId, linkId: link.linkId, orderRef }, occurredAt);
    audit('conversion.recorded', id, conversionId);
    return record;
  }

  function computeMargin(tenantId, input) {
    const id = text(tenantId, 'tenantId');
    if (!input || typeof input !== 'object') throw new TypeError('margin input is required');
    const scope = partition(id);
    const conversion = owned(scope, id, 'conversions', input.conversionId);
    const costMinorUnits = minorUnits(input.costMinorUnits, 'costMinorUnits');
    const marginId = mint('mgn');
    const occurredAt = nowIso();
    const record = Object.freeze({
      tenantId: id,
      marginId,
      conversionId: conversion.conversionId,
      currency: conversion.currency,
      grossCommissionMinorUnits: conversion.grossCommissionMinorUnits,
      costMinorUnits,
      netMarginMinorUnits: conversion.grossCommissionMinorUnits - costMinorUnits,
      computedAt: occurredAt
    });
    scope.margins.set(marginId, record);
    appendEvent(scope, id, 'margin.computed', { marginId, conversionId: conversion.conversionId }, occurredAt);
    audit('margin.computed', id, marginId);
    return record;
  }

  function emitDomainEvent(event) {
    if (!event || typeof event !== 'object') throw new TypeError('event is required');
    const id = text(event.tenantId, 'tenantId');
    const scope = partition(id);
    const occurredAt = event.occurredAt == null ? nowIso() : requiredTimestamp(event.occurredAt, 'occurredAt');
    return appendEvent(scope, id, event.type, event.payload, occurredAt);
  }

  function drainOutbox(tenantId, options = {}) {
    const id = text(tenantId, 'tenantId');
    const scope = partition(id);
    if (options == null || typeof options !== 'object') throw new TypeError('options must be an object');
    let limit = Infinity;
    if (options.limit != null) {
      if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
        throw new Error('limit must be a positive integer');
      }
      limit = options.limit;
    }
    const pending = [];
    for (const entry of scope.outbox) {
      if (!entry.dispatched) pending.push(entry);
      if (pending.length === limit) break;
    }
    const drained = pending.map((entry) => entry.event);
    for (const entry of pending) entry.dispatched = true;
    return drained;
  }

  return Object.freeze({
    registerProduct,
    publishOffer,
    generateLink,
    recordClick,
    recordConversion,
    computeMargin,
    emitDomainEvent,
    drainOutbox
  });
}
