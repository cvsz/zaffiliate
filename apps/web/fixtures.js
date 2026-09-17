const fixtureStamp = '2026-08-21T06:00:00Z';

export const approvalRecords = [
  { id: 'apr-1001', kind: 'payout_batch', title: 'Release creator payout batch PB-2201', requestedBy: 'op://operators/ana', impactMinor: 1250000, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1002', kind: 'campaign_budget', title: 'Raise daily budget of campaign CMP-88 to $400', requestedBy: 'op://operators/ben', impactMinor: 40000, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1003', kind: 'content_publish', title: 'Publish video brief VB-114 to Shopee storefront', requestedBy: 'op://operators/cleo', impactMinor: 0, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1004', kind: 'creator_suppression', title: 'Suppress creator cr_7712 after consent withdrawal', requestedBy: 'op://operators/ana', impactMinor: 0, currency: 'USD', status: 'pending', createdAt: fixtureStamp }
];

export const auditRows = [
  { id: 'aud-9001', at: fixtureStamp, actor: 'op://operators/ana', action: 'approval.granted', resource: 'workflow/approval/apr-0998', outcome: 'ok' },
  { id: 'aud-9002', at: fixtureStamp, actor: 'op://operators/ben', action: 'tenant.settings.updated', resource: 'tenant/settings', outcome: 'ok' },
  { id: 'aud-9003', at: fixtureStamp, actor: 'svc://workflow/runner', action: 'secret.read', resource: 'ref:vault/tiktok-shop/credentials', outcome: 'denied' },
  { id: 'aud-9004', at: fixtureStamp, actor: 'op://operators/cleo', action: 'billing.invoice.fetched', resource: 'ref:vault/billing/invoice/INV-2026-08-0042', outcome: 'ok' }
];

export const billingSummary = {
  plan: 'scale',
  period: '2026-08',
  currency: 'USD',
  mrrMinor: 249000,
  usage: { jobs_minutes: 1240, ai_tokens: 812500, webhook_calls: 45231 },
  quotas: { jobs_minutes: 5000, ai_tokens: 2000000, webhook_calls: 100000 },
  ledgerRef: 'ref:vault/billing/ledger/2026-08',
  invoiceRef: 'ref:vault/billing/invoice/INV-2026-08-0042'
};

export const outreachAttempts = [
  { id: 'otr-5501', channel: 'email', creator: 'cr_4417', template: 'reengage-v3', status: 'delivered', consentRef: 'ref:vault/consent/cr_4417', sentAt: fixtureStamp },
  { id: 'otr-5502', channel: 'dm_tiktok', creator: 'cr_5093', template: 'seed-box-v1', status: 'queued', consentRef: 'ref:vault/consent/cr_5093', sentAt: null },
  { id: 'otr-5503', channel: 'dm_instagram', creator: 'cr_6120', template: 'drop-announce-v2', status: 'bounced', consentRef: 'ref:vault/consent/cr_6120', sentAt: fixtureStamp },
  { id: 'otr-5504', channel: 'email', creator: 'cr_7712', template: 'reengage-v3', status: 'suppressed', consentRef: 'ref:vault/consent/cr_7712', sentAt: null }
];

export const funnelSnapshot = {
  window: '2026-08-14/2026-08-21',
  attributionModel: 'last-touch-subid',
  currency: 'USD',
  stages: [
    { stage: 'impression', events: 1250000, conversionPct: 100 },
    { stage: 'click', events: 62400, conversionPct: 4.99 },
    { stage: 'checkout', events: 8120, conversionPct: 13.01 },
    { stage: 'order', events: 3411, conversionPct: 42.01 }
  ],
  totals: { orders: 3411, gmvMinor: 4821500, commissionMinor: 512700, marginPct: 78.4, settlementRef: 'ref:vault/settlements/2026-08', payoutsQueued: 3 }
};