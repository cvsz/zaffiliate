import { buildEventEnvelope } from '../../packages/analytics/src/events.js';
export default function envelopeFactory(clock, seq, productId) {
  const type = Number(seq.slice(1)) % 3 === 0 ? 'commission_reported' : 'affiliate_click_recorded';
  return buildEventEnvelope({
    organizationId: 'org-A', provider: 'tiktok', type,
    sourceType: type === 'commission_reported' ? 'AFFILIATE_PROVIDER_REPORTED' : 'FIRST_PARTY',
    occurredAt: new Date(clock()).toISOString(),
    externalEventId: `w-${productId}-${seq}`,
    productId,
    affiliateLinkId: type === 'affiliate_click_recorded' ? 'lnk_w' : undefined,
    payload: type === 'commission_reported'
      ? { status: 'approved', amountMinorUnits: 500, currency: 'THB' }
      : {}
  });
}
