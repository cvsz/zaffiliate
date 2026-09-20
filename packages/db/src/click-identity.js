import { createHash } from 'node:crypto';

function required(value, name) {
  const normalized = String(value ?? '').normalize('NFC').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function canonicalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('touchpoint.occurredAt must be a valid timestamp');
  return date.toISOString();
}

export function normalizeClickProvenance(tenantId, linkId, touchpoint) {
  if (!touchpoint || typeof touchpoint !== 'object' || Array.isArray(touchpoint)) {
    throw new TypeError('touchpoint is required');
  }

  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    linkId: required(linkId, 'linkId'),
    source: required(touchpoint.source, 'source'),
    medium: required(touchpoint.medium, 'medium'),
    occurredAt: canonicalTimestamp(touchpoint.occurredAt),
    visitorHash: touchpoint.visitorHash == null ? '' : required(touchpoint.visitorHash, 'visitorHash')
  });
}

export function deterministicClickId(tenantId, linkId, touchpoint) {
  const provenance = normalizeClickProvenance(tenantId, linkId, touchpoint);
  const canonical = JSON.stringify([
    provenance.tenantId,
    provenance.linkId,
    provenance.source,
    provenance.medium,
    provenance.occurredAt,
    provenance.visitorHash
  ]);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('base64url');
  return `clk_${digest}`;
}
