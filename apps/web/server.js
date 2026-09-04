import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { controlPlaneManifest } from '../../packages/control-plane/src/navigation.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, 'public');
const buildDir = resolve(here, 'dist/web');

function getContentType(pathname) {
  const ext = pathname.split('.').pop()?.toLowerCase();
  const map = {
    'html': 'text/html; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
    'mjs': 'text/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'svg': 'image/svg+xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'eot': 'application/vnd.ms-fontobject',
    'json': 'application/json; charset=utf-8'
  };
  return map[ext || ''] || 'application/octet-stream';
}

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/privacy', ['privacy.html', 'text/html; charset=utf-8']],
  ['/terms', ['terms.html', 'text/html; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/views.js', ['views.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/tokens.css', ['tokens.css', 'text/css; charset=utf-8']]
]);

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function countPublished(dataProviders) {
  try {
    if (!dataProviders.publishedContentCount) return 0;
    const value = Number(await dataProviders.publishedContentCount());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export async function buildOverviewPayload({ tenant, dataProviders = {}, approvals = [], now = new Date().toISOString() }) {
  let summary = null;
  let degraded = false;
  try {
    summary = dataProviders.analyticsSummary ? await dataProviders.analyticsSummary(tenant) : null;
  } catch {
    degraded = true;
  }
  const safe = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  let activeSwitches = [];
  try {
    activeSwitches = dataProviders.killSwitches ? (await dataProviders.killSwitches(tenant)).filter((entry) => entry.active) : [];
  } catch {
    degraded = true;
  }
  let expiring = [];
  try {
    expiring = dataProviders.expiringPromotions ? (await dataProviders.expiringPromotions(tenant)) : [];
  } catch {
    degraded = true;
  }

  const pendingApprovals = approvals.filter((record) => record.status === 'pending').length;
  const criticalFailures = activeSwitches.length + (degraded ? 1 : 0);

  const primary = Object.freeze([
    { id: 'net_commission', label: 'Net Commission', valueMinorUnits: safe(summary?.netCommissionMinorUnits), currency: summary?.currency ?? 'USD' },
    { id: 'conversions', label: 'Conversions', value: safe(summary?.conversions) },
    { id: 'affiliate_clicks', label: 'Affiliate Clicks', value: safe(summary?.clicks) },
    { id: 'published_content', label: 'Published Content', value: await countPublished(dataProviders) },
    { id: 'pending_approvals', label: 'Pending Approvals', value: pendingApprovals },
    { id: 'critical_failures', label: 'Critical Failures', value: criticalFailures }
  ]);

  const secondary = Object.freeze([
    { id: 'ctr', label: 'CTR', value: summary ? safe(summary.ctr) : null, format: 'ratio' },
    { id: 'cvr', label: 'CVR', value: summary ? safe(summary.cvr) : null, format: 'ratio' },
    { id: 'epc', label: 'EPC', valueMinorUnits: summary ? safe(summary.epcMinorUnits) : null },
    { id: 'pending_commission', label: 'Pending Commission', valueMinorUnits: safe(summary?.pendingCommissionMinorUnits), currency: summary?.currency ?? 'USD' }
  ]);

  const actionCenter = [];
  for (const entry of activeSwitches) {
    actionCenter.push({
      id: `kill:${entry.scope}:${entry.id ?? 'global'}`,
      severity: 'DANGER',
      impact: `New ${entry.scope}-scoped automation is blocked`,
      resource: `${entry.scope}:${escapeHtml(entry.id ?? 'global')}`,
      reason: escapeHtml(entry.reason),
      recommendedAction: 'Mitigate the incident, then deactivate the switch from Automation > Kill Switches',
      detectedAt: entry.setAt ?? now
    });
  }
  for (const promotion of expiring) {
    actionCenter.push({
      id: `promo:${promotion.promotionId}`,
      severity: 'WARNING',
      impact: 'Scheduled content may outlive its promotion window',
      resource: `promotion:${escapeHtml(promotion.promotionId)}`,
      reason: `${escapeHtml(promotion.type)} ends at ${promotion.endsAt}`,
      recommendedAction: 'Refresh creative claims or reschedule inside the validity window',
      detectedAt: now
    });
  }
  if (degraded) {
    actionCenter.push({
      id: 'analytics_source_unavailable',
      severity: 'CRITICAL',
      impact: 'Mission Control KPIs are incomplete',
      resource: 'analytics-store',
      reason: 'analytics summary provider failed',
      recommendedAction: 'Check database health; KPI values shown as zero are not confirmed zeros',
      detectedAt: now
    });
  }

  return Object.freeze({
    tenant,
    freshness: Object.freeze({ generatedAt: now, degraded }),
    kpis: Object.freeze({ primary, secondary }),
    actionCenter: Object.freeze(actionCenter.map((item) => Object.freeze(item)))
  });
}

const fixtureStamp = '2026-08-21T06:00:00Z';

const approvalRecords = [
  { id: 'apr-1001', kind: 'payout_batch', title: 'Release creator payout batch PB-2201', requestedBy: 'op://operators/ana', impactMinor: 1250000, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1002', kind: 'campaign_budget', title: 'Raise daily budget of campaign CMP-88 to $400', requestedBy: 'op://operators/ben', impactMinor: 40000, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1003', kind: 'content_publish', title: 'Publish video brief VB-114 to Shopee storefront', requestedBy: 'op://operators/cleo', impactMinor: 0, currency: 'USD', status: 'pending', createdAt: fixtureStamp },
  { id: 'apr-1004', kind: 'creator_suppression', title: 'Suppress creator cr_7712 after consent withdrawal', requestedBy: 'op://operators/ana', impactMinor: 0, currency: 'USD', status: 'pending', createdAt: fixtureStamp }
];

const auditRows = [
  { id: 'aud-9001', at: fixtureStamp, actor: 'op://operators/ana', action: 'approval.granted', resource: 'workflow/approval/apr-0998', outcome: 'ok' },
  { id: 'aud-9002', at: fixtureStamp, actor: 'op://operators/ben', action: 'tenant.settings.updated', resource: 'tenant/settings', outcome: 'ok' },
  { id: 'aud-9003', at: fixtureStamp, actor: 'svc://workflow/runner', action: 'secret.read', resource: 'ref:vault/tiktok-shop/credentials', outcome: 'denied' },
  { id: 'aud-9004', at: fixtureStamp, actor: 'op://operators/cleo', action: 'billing.invoice.fetched', resource: 'ref:vault/billing/invoice/INV-2026-08-0042', outcome: 'ok' }
];

const billingSummary = {
  plan: 'scale',
  period: '2026-08',
  currency: 'USD',
  mrrMinor: 249000,
  usage: { jobs_minutes: 1240, ai_tokens: 812500, webhook_calls: 45231 },
  quotas: { jobs_minutes: 5000, ai_tokens: 2000000, webhook_calls: 100000 },
  ledgerRef: 'ref:vault/billing/ledger/2026-08',
  invoiceRef: 'ref:vault/billing/invoice/INV-2026-08-0042'
};

const outreachAttempts = [
  { id: 'otr-5501', channel: 'email', creator: 'cr_4417', template: 'reengage-v3', status: 'delivered', consentRef: 'ref:vault/consent/cr_4417', sentAt: fixtureStamp },
  { id: 'otr-5502', channel: 'dm_tiktok', creator: 'cr_5093', template: 'seed-box-v1', status: 'queued', consentRef: 'ref:vault/consent/cr_5093', sentAt: null },
  { id: 'otr-5503', channel: 'dm_instagram', creator: 'cr_6120', template: 'drop-announce-v2', status: 'bounced', consentRef: 'ref:vault/consent/cr_6120', sentAt: fixtureStamp },
  { id: 'otr-5504', channel: 'email', creator: 'cr_7712', template: 'reengage-v3', status: 'suppressed', consentRef: 'ref:vault/consent/cr_7712', sentAt: null }
];

const funnelSnapshot = {
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

function clone(value) {
  return structuredClone(value);
}

export function applySecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

function sendJson(res, status, payload, headOnly = false, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(headOnly ? undefined : body);
}

function readJsonBody(req, limit = 65536) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        req.resume();
        return;
      }
      if (!overflow) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overflow) rejectBody(new Error('payload_too_large'));
      else resolveBody(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', rejectBody);
  });
}

function isValidTenant(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128;
}

async function approveWorkflow(req, res, tenant) {
  if (req.headers['x-zaff-csrf'] !== '1') {
    return sendJson(res, 403, { error: 'csrf_check_failed' });
  }
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return sendJson(res, 403, { error: 'csrf_check_failed' });
  }
  const origin = req.headers.origin;
  if (origin != null) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return sendJson(res, 403, { error: 'csrf_check_failed' });
      }
    } catch {
      return sendJson(res, 403, { error: 'csrf_check_failed' });
    }
  }
  let raw;
  try {
    raw = await readJsonBody(req);
  } catch {
    return sendJson(res, 413, { error: 'payload_too_large' }, false, { connection: 'close' });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return sendJson(res, 400, { error: 'invalid_body' });
  }
  const { approvalId, decision } = parsed;
  if (typeof approvalId !== 'string' || approvalId.trim() === '') {
    return sendJson(res, 400, { error: 'invalid_approval_id' });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return sendJson(res, 400, { error: 'invalid_decision' });
  }
  const record = approvalRecords.find((candidate) => candidate.id === approvalId);
  if (!record) return sendJson(res, 404, { error: 'approval_not_found' });
  if (record.status !== 'pending') {
    return sendJson(res, 409, { error: 'already_decided', approval: { id: record.id, status: record.status } });
  }
  record.status = decision === 'approve' ? 'approved' : 'rejected';
  record.decidedAt = new Date().toISOString();
  record.decidedBy = `op://${tenant}`;
  return sendJson(res, 200, { ok: true, approval: clone(record) });
}

async function handleApi(req, res, pathname, state = {}) {
  const headOnly = req.method === 'HEAD';
  const tenantHeader = req.headers['x-tenant-id'];
  if (!isValidTenant(tenantHeader)) {
    return sendJson(res, 400, { error: 'tenant_header_required' }, headOnly);
  }
  const tenant = String(tenantHeader).trim();
  if (req.method === 'GET' || headOnly) {
    switch (pathname) {
      case '/api/ui/overview':
        return sendJson(res, 200, await buildOverviewPayload({ tenant, dataProviders: state.dataProviders, approvals: approvalRecords }), headOnly);
      case '/api/ui/revenue-trend': {
        let base = 0;
        try { const s = await state.dataProviders?.analyticsSummary?.(tenant); base = Math.max(0, Number(s?.netCommissionMinorUnits ?? 0)); } catch { base = 0; }
        const points = Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          netCommissionMinorUnits: base + i * 100,
          conversions: i + 1
        }));
        return sendJson(res, 200, { tenant, points }, headOnly);
      }
      case '/api/ui/integration-health': {
        const registry = state.dataProviders?.providerHealth ? await state.dataProviders.providerHealth(tenant).catch(() => []) : [];
        const integrations = registry.length ? registry : [{ platform: 'tiktok', status: 'degraded', lastVerifiedAt: new Date().toISOString(), reason: 'sandbox credential probe 40006' }, { platform: 'shopee', status: 'unknown', lastVerifiedAt: null }];
        return sendJson(res, 200, { tenant, integrations }, headOnly);
      }
      case '/api/ui/worker-health': {
        const queues = state.dataProviders?.queueDepth ? await state.dataProviders.queueDepth(tenant).catch(() => ({})) : {};
        return sendJson(res, 200, { tenant, workers: [{ name: 'outbox-dispatcher', status: 'healthy', depth: queues.outbox ?? 0 }, { name: 'publication-claimer', status: 'healthy', depth: queues.publications ?? 0 }] }, headOnly);
      }
      case '/api/navigation':
        return sendJson(res, 200, { ...controlPlaneManifest(), tenant }, headOnly);
      case '/api/audit':
        return sendJson(res, 200, { tenant, rows: clone(auditRows) }, headOnly);
      case '/api/billing/summary':
        return sendJson(res, 200, { tenant, ...clone(billingSummary) }, headOnly);
      case '/api/workflow/pending-approvals':
        return sendJson(res, 200, { tenant, approvals: clone(approvalRecords.filter((record) => record.status === 'pending')) }, headOnly);
      case '/api/outreach/attempts':
        return sendJson(res, 200, { tenant, attempts: clone(outreachAttempts) }, headOnly);
      case '/api/analytics/funnel':
        return sendJson(res, 200, { tenant, ...clone(funnelSnapshot) }, headOnly);
      case '/api/creator-studio/overview':
        return sendJson(res, 200, { tenant, creators: [{ id: 'cr_4417', status: 'active', campaigns: 2 }, { id: 'cr_5093', status: 'pending', campaigns: 0 }], note: 'minimal creator-studio surface — full UI deferred but API now present' }, headOnly);
      case '/api/ai-studio/overview':
        return sendJson(res, 200, { tenant, agents: ['product-research','copy-script','publisher'], mockProviders: ['mock-llm','mock-image','mock-video'], note: 'minimal ai-studio surface — deterministic mock transport, real LLM bindings BLOCKED B2' }, headOnly);
      default:
        return sendJson(res, 404, { error: 'not_found' }, headOnly);
    }
  }
  if (req.method === 'POST' && pathname === '/api/workflow/approve') {
    return approveWorkflow(req, res, tenant);
  }
  return sendJson(res, 405, { error: 'method_not_allowed' }, headOnly, { allow: 'GET, HEAD, POST' });
}

async function handleStatic(req, res, pathname) {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    return sendJson(res, 405, { error: 'method_not_allowed' }, false, { allow: 'GET, HEAD' });
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 403, { error: 'forbidden' }, headOnly);
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    return sendJson(res, 403, { error: 'forbidden' }, headOnly);
  }

  const buildPath = join(buildDir, decoded);
  try {
    const buildStat = await stat(buildPath);
    if (buildStat.isFile()) {
      const contentType = getContentType(decoded);
      const body = await readFile(buildPath);
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=300' });
      return res.end(headOnly ? undefined : body);
    }
  } catch {
    // fall through to public dir
  }

  const entry = files.get(pathname) ?? files.get(decoded);
  if (entry) {
    const [filename, contentType] = entry;
    try {
      const body = await readFile(join(publicDir, filename));
      res.writeHead(200, { 'content-type': contentType, 'cache-control': filename === 'index.html' ? 'no-store' : 'public, max-age=300' });
      return res.end(headOnly ? undefined : body);
    } catch {
      return sendJson(res, 500, { error: 'asset_read_failed' }, headOnly);
    }
  }

  return sendJson(res, 404, { error: 'not_found' }, headOnly);
}

export function buildWebServer({ dataProviders = {} } = {}) {
  const state = { dataProviders };
  return http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    try {
      if (pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, service: 'zaffiliate-web' }));
      }
      if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, state);
      return await handleStatic(req, res, pathname);
    } catch {
      return sendJson(res, 500, { error: 'internal_error' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.WEB_PORT || 3000);
  buildWebServer().listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'web_started', port })));
}
