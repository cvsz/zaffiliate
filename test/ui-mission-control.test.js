import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWebServer, escapeHtml, buildOverviewPayload } from '../apps/web/server.js';

const TENANT = { 'x-tenant-id': 'org-A' };

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('overview api is tenant-gated like every other control-plane route', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const denied = await fetch(`http://127.0.0.1:${port}/api/ui/overview`);
  assert.equal(denied.status, 400);
});

test('zero-state overview exposes six primary KPIs and an empty action center', async (t) => {
  const server = buildWebServer();
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/ui/overview`, { headers: TENANT });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.kpis.primary.length, 6);
  assert.deepEqual(body.kpis.primary.map((kpi) => kpi.id), [
    'net_commission', 'conversions', 'affiliate_clicks', 'published_content', 'pending_approvals', 'critical_failures'
  ]);
  assert.equal(body.actionCenter.length, 0);
  assert.ok(body.freshness.generatedAt);
});

test('overview reflects injected real stores instead of fixtures', async (t) => {
  const analyticsSummary = async () => ({
    impressions: 100, clicks: 20, conversions: 4,
    netCommissionMinorUnits: 1500, pendingCommissionMinorUnits: 500,
    epcMinorUnits: 75
  });
  const killSwitches = async () => [
    { scope: 'provider', id: 'tiktok', active: true, reason: 'provider-outage', setAt: '2026-08-24T06:00:00Z' }
  ];
  const expiringPromotions = async () => [
    { promotionId: 'prm_1', type: 'FLASH_SALE', endsAt: '2026-08-24T20:00:00Z' }
  ];
  const server = buildWebServer({ dataProviders: { analyticsSummary, killSwitches, expiringPromotions } });
  t.after(() => server.close());
  const port = await listen(server);
  const body = await (await fetch(`http://127.0.0.1:${port}/api/ui/overview`, { headers: TENANT })).json();
  const byId = Object.fromEntries(body.kpis.primary.map((kpi) => [kpi.id, kpi]));
  assert.equal(byId.net_commission.valueMinorUnits, 1500);
  assert.equal(byId.affiliate_clicks.value, 20);
  assert.equal(byId.pending_approvals.value > 0, true, 'pending approvals come from the live approval records');
  const severities = body.actionCenter.map((item) => item.severity);
  assert.ok(severities.includes('DANGER'), 'active kill switch must surface as DANGER');
  assert.ok(severities.includes('WARNING'), 'expiring promotion must surface as WARNING');
  const killItem = body.actionCenter.find((item) => item.severity === 'DANGER');
  assert.match(killItem.reason, /provider-outage/);
  assert.ok(killItem.recommendedAction.length > 0);
});

test('failing providers degrade to error state without crashing the payload', async (t) => {
  const server = buildWebServer({
    dataProviders: { analyticsSummary: async () => { throw new Error('db down'); } }
  });
  t.after(() => server.close());
  const port = await listen(server);
  const body = await (await fetch(`http://127.0.0.1:${port}/api/ui/overview`, { headers: TENANT })).json();
  assert.equal(body.freshness.degraded, true);
  assert.equal(body.kpis.primary[0].valueMinorUnits, 0);
});

test('tokens stylesheet defines the semantic severity and theme layers', async () => {
  const css = await readFile(new URL('../apps/web/public/tokens.css', import.meta.url), 'utf8');
  for (const token of ['--sev-info', '--sev-success', '--sev-warning', '--sev-danger', '--sev-critical', '--surface', '--foreground', '--muted']) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
  assert.ok(css.includes('[data-theme="dark"]'), 'dark theme overrides required');
  assert.ok(!css.includes('<script'), 'stylesheet must stay script-free for CSP');
});

test('escapeHtml neutralizes provider-controlled text (stored XSS regression)', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`TikTok" onmouseover="x`), 'TikTok&quot; onmouseover=&quot;x');
});
