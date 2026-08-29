import { createHash, randomUUID } from 'node:crypto';

export const EVENT_TYPES = new Set([
  'product_viewed',
  'content_generated',
  'content_approved',
  'publication_scheduled',
  'publication_submitted',
  'publication_published',
  'impression_recorded',
  'video_view_recorded',
  'engagement_recorded',
  'affiliate_click_recorded',
  'redirect_completed',
  'conversion_reported',
  'order_reported',
  'commission_reported',
  'refund_reported',
  'commission_reversed',
  'payout_reported'
]);

export const SOURCE_TYPES = new Set([
  'FIRST_PARTY',
  'PROVIDER_REPORTED',
  'AFFILIATE_PROVIDER_REPORTED',
  'IMPORTED',
  'MODELED',
  'ESTIMATED',
  'PREDICTED'
]);

const LINEAGE_FIELDS = [
  ['campaignId', 'campaign_id'],
  ['productId', 'product_id'],
  ['creativeId', 'creative_id'],
  ['contentId', 'content_id'],
  ['publicationId', 'publication_id'],
  ['affiliateLinkId', 'affiliate_link_id'],
  ['clickId', 'click_id'],
  ['providerAccountId', 'provider_account_id']
];

const EVENT_VERSION = '1';

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function stableFingerprint({ provider, providerAccountId, type, payload, sourceTimestamp }) {
  const canonicalPayload = JSON.stringify(payload ?? {}, Object.keys(payload ?? {}).sort());
  return createHash('sha256')
    .update([provider, providerAccountId ?? '', type, canonicalPayload, sourceTimestamp ?? ''].join('|'))
    .digest('hex');
}

export function buildEventEnvelope({
  organizationId,
  provider = null,
  type,
  sourceType,
  occurredAt,
  receivedAt = new Date().toISOString(),
  externalEventId = null,
  correlationId = null,
  payload = {},
  sourceTimestamp = null,
  ...lineageInput
}) {
  const organization = requireText(organizationId, 'organizationId');
  const normalizedType = String(type ?? '').trim().toLowerCase();
  if (!EVENT_TYPES.has(normalizedType)) throw new Error(`unsupported analytics event type: ${type}`);
  const normalizedSource = String(sourceType ?? '').trim().toUpperCase();
  if (!SOURCE_TYPES.has(normalizedSource)) throw new Error(`unsupported source type: ${sourceType}`);

  const occurred = new Date(occurredAt ?? receivedAt);
  if (Number.isNaN(occurred.getTime())) throw new Error('occurredAt must be a valid timestamp');
  const received = new Date(receivedAt);

  const lineage = {};
  for (const [inputKey, envelopeKey] of LINEAGE_FIELDS) {
    const value = lineageInput[inputKey];
    if (value != null && String(value).trim()) lineage[envelopeKey] = String(value).trim();
  }
  if (normalizedType === 'affiliate_click_recorded' && !lineage.affiliate_link_id) {
    throw new Error('affiliate_link_id is required for affiliate_click_recorded');
  }

  const external = externalEventId == null ? null : requireText(externalEventId, 'externalEventId');
  const normalizedProvider = provider == null ? null : requireText(provider, 'provider').toLowerCase();

  const dedupeKey = external
    ? `ext:${normalizedProvider ?? ''}:${external}`
    : `fp:${stableFingerprint({ provider: normalizedProvider, providerAccountId: lineage.provider_account_id, type: normalizedType, payload, sourceTimestamp })}`;

  const eventId = `evt_${createHash('sha256').update(`${organization}|${dedupeKey}`).digest('hex').slice(0, 24)}`;

  return Object.freeze({
    eventId,
    eventVersion: EVENT_VERSION,
    eventType: normalizedType,
    occurredAt: occurred.toISOString(),
    receivedAt: received.toISOString(),
    lateArrivalMs: Math.max(0, received.getTime() - occurred.getTime()),
    organizationId: organization,
    provider: normalizedProvider,
    sourceType: normalizedSource,
    dedupeKey,
    externalEventId: external,
    correlationId: correlationId == null ? null : String(correlationId).trim(),
    lineage: Object.freeze(lineage),
    metadata: Object.freeze({}),
    payload: Object.freeze(JSON.parse(JSON.stringify(payload ?? {}))),
    _sourceTimestamp: sourceTimestamp
  });
}

export function createEventStore() {
  const partitions = new Map();

  function partition(organizationId) {
    const key = requireText(organizationId, 'organizationId');
    let scope = partitions.get(key);
    if (!scope) {
      scope = { byDedupe: new Map(), events: [] };
      partitions.set(key, scope);
    }
    return scope;
  }

  function ingest(envelope) {
    const scope = partition(envelope.organizationId);
    const existing = scope.byDedupe.get(envelope.dedupeKey);
    if (existing) {
      return Object.freeze({ accepted: false, duplicateOf: existing.eventId, stored: existing });
    }
    scope.byDedupe.set(envelope.dedupeKey, envelope);
    scope.events.push(envelope);
    return Object.freeze({ accepted: true, duplicateOf: null, stored: envelope });
  }

  function size(organizationId) {
    return partition(organizationId).events.length;
  }

  function summarize(organizationId) {
    const scope = partition(organizationId);
    const metrics = {
      impressions: 0,
      clicks: 0,
      conversions: 0,
      grossCommissionMinorUnits: 0,
      pendingCommissionMinorUnits: 0,
      refundMinorUnits: 0,
      reversalMinorUnits: 0
    };
    for (const event of scope.events) {
      switch (event.eventType) {
        case 'impression_recorded':
          metrics.impressions += 1;
          break;
        case 'affiliate_click_recorded':
          metrics.clicks += 1;
          break;
        case 'commission_reported': {
          const amount = Number(event.payload?.amountMinorUnits ?? 0);
          if (!Number.isFinite(amount)) break;
          if (String(event.payload?.status ?? '').toLowerCase() === 'pending') {
            metrics.pendingCommissionMinorUnits += amount;
          } else {
            metrics.grossCommissionMinorUnits += amount;
            metrics.conversions += 1;
          }
          break;
        }
        case 'refund_reported':
          metrics.refundMinorUnits += Number(event.payload?.amountMinorUnits ?? 0);
          break;
        case 'commission_reversed':
          metrics.reversalMinorUnits += Number(event.payload?.amountMinorUnits ?? 0);
          break;
        default:
          break;
      }
    }
    const net = Math.max(
      0,
      metrics.grossCommissionMinorUnits - metrics.refundMinorUnits - metrics.reversalMinorUnits
    );
    return Object.freeze({
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      conversions: metrics.conversions,
      ctr: metrics.impressions ? metrics.clicks / metrics.impressions : 0,
      cvr: metrics.clicks ? metrics.conversions / metrics.clicks : 0,
      grossCommissionMinorUnits: metrics.grossCommissionMinorUnits,
      pendingCommissionMinorUnits: metrics.pendingCommissionMinorUnits,
      refundMinorUnits: metrics.refundMinorUnits + metrics.reversalMinorUnits,
      netCommissionMinorUnits: net,
      epcMinorUnits: metrics.clicks ? Math.round(net / metrics.clicks) : 0
    });
  }

  function summarizeByProduct(organizationId) {
    const scope = partition(organizationId);
    const byProduct = new Map();
    function bucket(productId) {
      const key = String(productId ?? '').trim() || '_unattributed';
      let entry = byProduct.get(key);
      if (!entry) {
        entry = { impressions: 0, clicks: 0, conversions: 0, grossCommissionMinorUnits: 0, refundMinorUnits: 0 };
        byProduct.set(key, entry);
      }
      return entry;
    }
    for (const event of scope.events) {
      const productId = event.lineage?.product_id;
      switch (event.eventType) {
        case 'impression_recorded':
          bucket(productId).impressions += 1;
          break;
        case 'affiliate_click_recorded':
          bucket(productId).clicks += 1;
          break;
        case 'commission_reported': {
          const amount = Number(event.payload?.amountMinorUnits ?? 0);
          if (!Number.isFinite(amount)) break;
          const entry = bucket(productId);
          if (String(event.payload?.status ?? '').toLowerCase() === 'pending') break;
          entry.conversions += 1;
          entry.grossCommissionMinorUnits += amount;
          break;
        }
        case 'refund_reported':
          bucket(productId).refundMinorUnits += Number(event.payload?.amountMinorUnits ?? 0);
          break;
        default:
          break;
      }
    }
    for (const [, entry] of byProduct) {
      entry.netCommissionMinorUnits = Math.max(0, entry.grossCommissionMinorUnits - entry.refundMinorUnits);
      Object.freeze(entry);
    }
    return byProduct;
  }

  function rawEvents(organizationId) {
    return Object.freeze([...partition(organizationId).events]);
  }

  return Object.freeze({ ingest, size, summarize, summarizeByProduct, rawEvents });
}
