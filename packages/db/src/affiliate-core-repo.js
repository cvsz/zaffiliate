import { randomBytes, randomUUID } from 'node:crypto';
import { deterministicClickId, normalizeClickProvenance } from './click-identity.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function tenantId(value) {
  const id = required(value, 'tenantId');
  if (!UUID_PATTERN.test(id)) throw new Error('tenantId must be a UUID');
  return id;
}

function currency(value) {
  const code = required(value, 'currency').toUpperCase();
  if (!CURRENCY_PATTERN.test(code)) throw new Error('currency must be a 3-letter ISO currency code');
  return code;
}

function minorUnits(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
  return value;
}

function commissionRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('commissionRate must be between 0 and 1');
  return rate;
}

function timestamp(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function token() { return randomBytes(12).toString('base64url'); }
function mint(prefix) { return `${prefix}_${token()}`; }
function rows(result) { return Array.isArray(result?.rows) ? result.rows : []; }
async function setTenant(tx, id) { await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]); }
function mapProduct(row) { return Object.freeze({ tenantId: row.tenant_id, productId: row.runtime_id, platform: row.platform, externalProductId: row.external_product_id, title: row.title, currency: row.currency, createdAt: new Date(row.created_at).toISOString() }); }
function mapOffer(row) { return Object.freeze({ tenantId: row.tenant_id, offerId: row.runtime_id, productId: row.product_runtime_id, priceMinorUnits: Number(row.price_minor_units), currency: row.currency, commissionRate: Number(row.commission_rate), capturedAt: new Date(row.captured_at ?? row.created_at).toISOString(), createdAt: new Date(row.created_at).toISOString() }); }
function mapLink(row) { return Object.freeze({ tenantId: row.tenant_id, linkId: row.runtime_id, offerId: row.offer_runtime_id, productId: row.product_runtime_id, campaignId: row.campaign_id ?? null, destinationUrl: row.destination_url ?? row.url, deepLinkUrl: row.deep_link_url ?? row.url, subIds: Object.freeze(row.sub_ids ?? {}), slug: row.slug ?? null, expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString() }); }
function mapConversion(row) {
  const evidence = typeof row.commission_evidence === 'string' ? JSON.parse(row.commission_evidence) : (row.commission_evidence ?? {});
  return Object.freeze({ tenantId: row.tenant_id, conversionId: row.runtime_id, linkId: row.link_runtime_id, offerId: row.offer_runtime_id, productId: row.product_runtime_id, orderRef: row.external_order_id, revenueMinorUnits: Number(row.revenue_minor_units), currency: row.currency, commissionRate: Number(row.commission_rate), grossCommissionMinorUnits: Number(row.gross_commission_minor_units), commissionEvidence: Object.freeze({ ...evidence }), occurredAt: new Date(row.occurred_at).toISOString() });
}

const LINK_SELECT = `
  SELECT l.*, o.runtime_id AS offer_runtime_id, p.runtime_id AS product_runtime_id
  FROM affiliate_links l
  JOIN offers o ON o.id = l.offer_id AND o.tenant_id = l.tenant_id
  JOIN products p ON p.id = o.product_id AND p.tenant_id = l.tenant_id
`;
const CONVERSION_SELECT = `
  SELECT c.*, l.runtime_id AS link_runtime_id,
         o.runtime_id AS offer_runtime_id, p.runtime_id AS product_runtime_id
  FROM conversions c
  JOIN affiliate_links l ON l.id = c.affiliate_link_id AND l.tenant_id = c.tenant_id
  JOIN offers o ON o.id = c.offer_id AND o.tenant_id = c.tenant_id
  JOIN products p ON p.id = o.product_id AND p.tenant_id = c.tenant_id
`;

export function createAffiliateCoreRepo({ db, clock = () => Date.now() } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction() is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  function nowIso() { return new Date(clock()).toISOString(); }
  async function inTenant(rawTenantId, fn) { const id = tenantId(rawTenantId); return db.transaction(async (tx) => { await setTenant(tx, id); return fn(tx, id); }); }
  async function enqueue(tx, id, type, payload, occurredAt = nowIso()) {
    const eventId = `evt_${randomUUID()}`;
    await tx.query(`INSERT INTO affiliate_domain_outbox (tenant_id, event_id, event_type, payload, occurred_at) VALUES ($1, $2, $3, $4::jsonb, $5)`, [id, eventId, required(type, 'event.type'), JSON.stringify(payload ?? {}), occurredAt]);
    return Object.freeze({ eventId, tenantId: id, type, payload: Object.freeze({ ...(payload ?? {}) }), occurredAt });
  }
  async function registerProduct(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('product is required');
    return inTenant(rawTenantId, async (tx, id) => { const productId = input.productId == null ? mint('prod') : required(input.productId, 'productId'); const occurredAt = nowIso(); const result = await tx.query(`INSERT INTO products (tenant_id, runtime_id, platform, external_product_id, title, currency, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [id, productId, required(input.platform, 'platform').toLowerCase(), required(input.externalProductId, 'externalProductId'), required(input.title, 'title'), currency(input.currency ?? 'THB'), occurredAt]); const row = rows(result)[0]; await enqueue(tx, id, 'product.registered', { productId }, occurredAt); return mapProduct(row); });
  }
  async function publishOffer(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('offer input is required');
    return inTenant(rawTenantId, async (tx, id) => { const productResult = await tx.query('SELECT id, runtime_id FROM products WHERE tenant_id = $1 AND runtime_id = $2', [id, required(input.productId, 'productId')]); const product = rows(productResult)[0]; if (!product) throw new Error(`product ${input.productId} not found`); const offerId = mint('off'); const price = minorUnits(input.price, 'price'); const code = currency(input.currency); const rate = commissionRate(input.commissionRate); const occurredAt = nowIso(); const result = await tx.query(`INSERT INTO offers (tenant_id, runtime_id, product_id, sale_price, price_minor_units, commission_rate, cost, currency, captured_at, created_at) VALUES ($1, $2, $3, $4, $4, $5, 0, $6, $7, $7) RETURNING *, $8::text AS product_runtime_id`, [id, offerId, product.id, price, rate, code, occurredAt, product.runtime_id]); await enqueue(tx, id, 'offer.published', { offerId, productId: product.runtime_id, priceMinorUnits: price, currency: code }, occurredAt); return mapOffer(rows(result)[0]); });
  }
  async function generateLink(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('link input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const offerResult = await tx.query(`SELECT o.id, o.runtime_id, p.runtime_id AS product_runtime_id FROM offers o JOIN products p ON p.id = o.product_id AND p.tenant_id = o.tenant_id WHERE o.tenant_id = $1 AND o.runtime_id = $2`, [id, required(input.offerId, 'offerId')]); const offer = rows(offerResult)[0]; if (!offer) throw new Error(`offer ${input.offerId} not found`);
      const campaignId = input.campaignId == null ? null : required(input.campaignId, 'campaignId').toLowerCase(); if (campaignId && !UUID_PATTERN.test(campaignId)) throw new Error('campaignId must be a UUID');
      if (campaignId) { const campaign = rows(await tx.query('SELECT id, status FROM campaigns WHERE tenant_id = $1 AND id = $2', [id, campaignId]))[0]; if (!campaign) throw new Error(`campaign ${campaignId} not found`); if (campaign.status !== 'active') throw new Error(`campaign ${campaignId} must be active to generate links`); }
      let destination; try { destination = new URL(required(input.destinationUrl, 'destinationUrl')); } catch { throw new Error('destinationUrl must be a valid URL'); } if (destination.protocol !== 'https:') throw new Error('affiliate link must use HTTPS');
      const slug = input.slug == null ? null : required(input.slug, 'slug').toLowerCase(); if (slug && !/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) throw new Error('slug must match [a-z0-9][a-z0-9-]{0,127}'); const expiresAt = input.expiresAt == null ? null : timestamp(input.expiresAt, 'expiresAt');
      const requested = input.subIds ?? ['subid']; const provided = Array.isArray(requested) ? {} : requested; const names = Array.isArray(requested) ? requested : Object.keys(requested ?? {}); if (!Array.isArray(names) || names.length === 0) throw new Error('subIds must not be empty'); const subIds = {}; for (const entry of names) { const key = required(entry, 'subIds name'); subIds[key] = String(provided?.[key] ?? '').trim() || token(); }
      const deep = new URL(destination.toString()); for (const [key, value] of Object.entries(subIds)) deep.searchParams.set(key, value); const linkId = mint('lnk'); const occurredAt = nowIso(); let result;
      try { result = await tx.query(`INSERT INTO affiliate_links (tenant_id, runtime_id, offer_id, campaign_id, url, destination_url, deep_link_url, sub_id, sub_ids, slug, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $5, $7, $8::jsonb, $9, $10, $11) RETURNING *, $12::text AS offer_runtime_id, $13::text AS product_runtime_id`, [id, linkId, offer.id, campaignId, deep.toString(), destination.toString(), Object.values(subIds)[0] ?? null, JSON.stringify(subIds), slug, expiresAt, occurredAt, offer.runtime_id, offer.product_runtime_id]); } catch (error) { if (slug && String(error?.code ?? '') === '23505') throw new Error(`slug ${slug} already exists`); throw error; }
      await enqueue(tx, id, 'link.generated', { linkId, offerId: offer.runtime_id, ...(campaignId ? { campaignId } : {}) }, occurredAt); return mapLink(rows(result)[0]);
    });
  }
  async function resolveLinkBySlug(rawTenantId, rawSlug) { const slug = String(rawSlug ?? '').trim().toLowerCase(); if (!slug) return null; return inTenant(rawTenantId, async (tx, id) => { const result = await tx.query(`${LINK_SELECT} WHERE l.tenant_id = $1 AND l.slug = $2 LIMIT 1`, [id, slug]); const row = rows(result)[0]; return row ? mapLink(row) : null; }); }
  async function resolveLinkById(rawTenantId, rawLinkId) { const linkId = String(rawLinkId ?? '').trim(); if (!linkId) return null; return inTenant(rawTenantId, async (tx, id) => { const result = await tx.query(`${LINK_SELECT} WHERE l.tenant_id = $1 AND l.runtime_id = $2 LIMIT 1`, [id, linkId]); const row = rows(result)[0]; return row ? mapLink(row) : null; }); }
  async function findLinkBySubId(rawTenantId, rawSubId) { const subId = String(rawSubId ?? '').trim(); if (!subId) return null; return inTenant(rawTenantId, async (tx, id) => { const result = await tx.query(`${LINK_SELECT} WHERE l.tenant_id = $1 AND EXISTS (SELECT 1 FROM jsonb_each_text(l.sub_ids) AS kv WHERE kv.value = $2) LIMIT 1`, [id, subId]); const row = rows(result)[0]; return row ? mapLink(row) : null; }); }
  async function recordClick(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('click input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const linkResult = await tx.query(`${LINK_SELECT} WHERE l.tenant_id = $1 AND l.runtime_id = $2 LIMIT 1`, [id, required(input.linkId, 'linkId')]); const link = rows(linkResult)[0]; if (!link) throw new Error(`link ${input.linkId} not found`);
      const provenance = normalizeClickProvenance(id, link.runtime_id, input.touchpoint); const normalized = { source: provenance.source, medium: provenance.medium, occurredAt: provenance.occurredAt, ...(provenance.visitorHash ? { visitorHash: provenance.visitorHash } : {}) }; const clickId = deterministicClickId(id, link.runtime_id, normalized); const recordedAt = nowIso();
      const inserted = await tx.query(`INSERT INTO affiliate_clicks (tenant_id, runtime_id, affiliate_link_id, touchpoint, recorded_at) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (tenant_id, runtime_id) DO NOTHING RETURNING tenant_id, runtime_id, touchpoint, recorded_at`, [id, clickId, link.id, JSON.stringify(normalized), recordedAt]);
      const winner = rows(inserted)[0];
      if (winner) await enqueue(tx, id, 'click.recorded', { clickId, linkId: link.runtime_id }, recordedAt);
      let durable = winner;
      if (!durable) { const existing = await tx.query('SELECT tenant_id, runtime_id, touchpoint, recorded_at FROM affiliate_clicks WHERE tenant_id = $1 AND runtime_id = $2 LIMIT 1', [id, clickId]); durable = rows(existing)[0]; if (!durable) throw new Error(`click ${clickId} replay could not be resolved`); }
      const durableTouchpoint = typeof durable.touchpoint === 'string' ? JSON.parse(durable.touchpoint) : durable.touchpoint;
      return Object.freeze({ tenantId: id, clickId: durable.runtime_id ?? clickId, linkId: link.runtime_id, offerId: link.offer_runtime_id, productId: link.product_runtime_id, subIds: Object.freeze(link.sub_ids ?? {}), touchpoint: Object.freeze(durableTouchpoint ?? normalized), recordedAt: new Date(durable.recorded_at ?? recordedAt).toISOString() });
    });
  }
  async function recordConversion(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('conversion input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const linkResult = await tx.query(`${LINK_SELECT} WHERE l.tenant_id = $1 AND l.runtime_id = $2 LIMIT 1`, [id, required(input.linkId, 'linkId')]);
      const link = rows(linkResult)[0];
      if (!link) throw new Error(`link ${input.linkId} not found`);
      const orderRef = required(input.orderRef, 'orderRef');
      const revenue = minorUnits(input.revenueMinorUnits, 'revenueMinorUnits');
      const code = currency(input.currency);
      const rate = commissionRate(input.commissionRate);
      const commission = minorUnits(input.grossCommissionMinorUnits, 'grossCommissionMinorUnits');
      const occurredAt = timestamp(input.occurredAt, 'occurredAt');
      const evidence = input.commissionEvidence;
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new TypeError('commissionEvidence must be an object');
      const conversionId = mint('cnv');
      const inserted = await tx.query(`INSERT INTO conversions (tenant_id, runtime_id, external_order_id, offer_id, affiliate_link_id, gross_revenue, commission, cost, currency, occurred_at, revenue_minor_units, gross_commission_minor_units, commission_rate, commission_evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb) ON CONFLICT (tenant_id, external_order_id) DO NOTHING RETURNING *`, [id, conversionId, orderRef, link.offer_id, link.id, revenue, commission, 0, code, occurredAt, revenue, commission, rate, JSON.stringify(evidence)]);
      let row = rows(inserted)[0];
      if (!row) {
        const existing = await tx.query(`${CONVERSION_SELECT} WHERE c.tenant_id = $1 AND c.external_order_id = $2 LIMIT 1`, [id, orderRef]);
        row = rows(existing)[0];
        if (!row) throw new Error(`conversion ${orderRef} replay could not be resolved`);
        return mapConversion(row);
      }
      row = { ...row, link_runtime_id: link.runtime_id, offer_runtime_id: link.offer_runtime_id, product_runtime_id: link.product_runtime_id };
      await enqueue(tx, id, 'conversion.recorded', { conversionId, linkId: link.runtime_id, orderRef }, occurredAt);
      return mapConversion(row);
    });
  }
  async function computeMargin(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('margin input is required');
    return inTenant(rawTenantId, async (tx, id) => { const conversionResult = await tx.query(`${CONVERSION_SELECT} WHERE c.tenant_id = $1 AND c.runtime_id = $2 LIMIT 1`, [id, required(input.conversionId, 'conversionId')]); const conversion = rows(conversionResult)[0]; if (!conversion) throw new Error(`conversion ${input.conversionId} not found`); const cost = minorUnits(input.costMinorUnits, 'costMinorUnits'); const gross = Number(conversion.gross_commission_minor_units); const marginId = mint('mgn'); const occurredAt = nowIso(); await tx.query(`INSERT INTO affiliate_margins (tenant_id, runtime_id, conversion_id, gross_commission_minor_units, cost_minor_units, net_margin_minor_units, currency, computed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, marginId, conversion.id, gross, cost, gross - cost, conversion.currency, occurredAt]); await enqueue(tx, id, 'margin.computed', { marginId, conversionId: conversion.runtime_id }, occurredAt); return Object.freeze({ tenantId: id, marginId, conversionId: conversion.runtime_id, currency: conversion.currency, grossCommissionMinorUnits: gross, costMinorUnits: cost, netMarginMinorUnits: gross - cost, computedAt: occurredAt }); });
  }
  return Object.freeze({ registerProduct, publishOffer, generateLink, resolveLinkBySlug, resolveLinkById, findLinkBySubId, recordClick, recordConversion, computeMargin });
}
