import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWebServer } from '../apps/web/server.js';

const here = dirname(fileURLToPath(import.meta.url));

async function withServer(fn) {
  const server = buildWebServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

const requiredCspDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
];

function assertSecurityHeaders(headers) {
  const csp = headers.get('content-security-policy') ?? '';
  for (const directive of requiredCspDirectives) {
    assert.ok(csp.includes(directive), `CSP missing directive: ${directive}`);
  }
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.match(headers.get('permissions-policy') ?? '', /camera=\(\)/);
}

function assertOnlyReferenceSecrets(value) {
  if (typeof value === 'string') {
    if (/vault|credential|password|bearer |sk-/i.test(value)) {
      assert.match(value, /^ref:/, `secret-shaped value must be a ref: pointer, got: ${value}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertOnlyReferenceSecrets(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) assertOnlyReferenceSecrets(item);
  }
}

test('GET / serves the shell HTML with CSP and every security header', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assertSecurityHeaders(response.headers);
    const html = await response.text();
    assert.match(html, /zaffiliate Control Plane/);

    for (const asset of ['/app.js', '/views.js', '/styles.css']) {
      const assetResponse = await fetch(`${base}${asset}`);
      assert.equal(assetResponse.status, 200, `${asset} should be served`);
      assertSecurityHeaders(assetResponse.headers);
      if (asset === '/styles.css') {
        assert.match(assetResponse.headers.get('content-type') ?? '', /text\/css/);
      } else {
        assert.match(assetResponse.headers.get('content-type') ?? '', /javascript/);
      }
    }
  });
});

test('encoded traversal, backslashes and absolute paths are rejected on static serving', async () => {
  await withServer(async (base) => {
    const probes = [
      '/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2fetc%2fpasswd',
      '/static/%2e%2e/%2e%2e/%2e%2e/etc/shadow',
      '/..%5c..%5cetc%5cpasswd',
      '/..%5cserver.js',
      '//etc/passwd',
      '/etc/passwd',
      '/index.html%00.js'
    ];
    for (const probe of probes) {
      const response = await fetch(`${base}${probe}`);
      assert.notEqual(response.status, 200, `${probe} must not be served`);
      assert.ok([403, 404].includes(response.status), `${probe} -> unexpected ${response.status}`);
      const body = await response.text();
      assert.doesNotMatch(body, /root:/);
      assert.doesNotMatch(body, /control-plane|zaffiliate Control Plane/);
    }
    // legit assets still served alongside the rejections
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
  });
});

const apiGetEndpoints = [
  '/api/navigation',
  '/api/audit',
  '/api/billing/summary',
  '/api/workflow/pending-approvals',
  '/api/outreach/attempts',
  '/api/analytics/funnel'
];

test('every API endpoint returns 400 without x-tenant-id', async () => {
  await withServer(async (base) => {
    for (const path of apiGetEndpoints) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 400, `${path} without tenant must 400`);
      assert.deepEqual(await response.json(), { error: 'tenant_header_required' });
      assertSecurityHeaders(response.headers);
    }
    const blank = await fetch(`${base}/api/audit`, { headers: { 'x-tenant-id': '   ' } });
    assert.equal(blank.status, 400);

    const postWithoutTenant = await fetch(`${base}/api/workflow/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalId: 'apr-1001', decision: 'approve' })
    });
    assert.equal(postWithoutTenant.status, 400);
    assert.deepEqual(await postWithoutTenant.json(), { error: 'tenant_header_required' });
  });
});

test('each fixture GET endpoint returns its expected shape', async () => {
  await withServer(async (base) => {
    const tenant = 'tenant-acme';
    const headers = { 'x-tenant-id': tenant };

    const navigationResponse = await fetch(`${base}/api/navigation`, { headers });
    assertSecurityHeaders(navigationResponse.headers);
    const navigation = await navigationResponse.json();
    assert.equal(navigation.product, 'zaffiliate');
    assert.equal(navigation.version, 1);
    assert.equal(navigation.secretBoundary, 'server-only');
    assert.equal(navigation.tenant, tenant);
    assert.ok(Array.isArray(navigation.sections) && navigation.sections.length >= 15);
    for (const section of navigation.sections) {
      assert.equal(typeof section.id, 'string');
      assert.equal(typeof section.label, 'string');
      assert.match(section.path, /^\//);
    }

    const audit = await (await fetch(`${base}/api/audit`, { headers })).json();
    assert.equal(audit.tenant, tenant);
    assert.ok(Array.isArray(audit.rows) && audit.rows.length > 0);
    for (const row of audit.rows) {
      for (const key of ['id', 'at', 'actor', 'action', 'resource', 'outcome']) {
        assert.equal(typeof row[key], 'string', `audit row missing ${key}`);
        assert.ok(row[key].length > 0);
      }
    }

    const billing = await (await fetch(`${base}/api/billing/summary`, { headers })).json();
    assert.equal(billing.tenant, tenant);
    assert.equal(typeof billing.plan, 'string');
    assert.equal(billing.period, '2026-08');
    assert.equal(typeof billing.mrrMinor, 'number');
    assert.equal(typeof billing.usage, 'object');
    assert.equal(typeof billing.quotas, 'object');
    assert.match(billing.ledgerRef, /^ref:/);
    assert.match(billing.invoiceRef, /^ref:/);

    const pendingBody = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers })).json();
    assert.equal(pendingBody.tenant, tenant);
    assert.ok(Array.isArray(pendingBody.approvals));
    for (const approval of pendingBody.approvals) {
      assert.match(approval.id, /^apr-/);
      assert.equal(approval.status, 'pending');
      assert.equal(typeof approval.title, 'string');
      assert.equal(typeof approval.kind, 'string');
      assert.equal(typeof approval.impactMinor, 'number');
    }

    const outreach = await (await fetch(`${base}/api/outreach/attempts`, { headers })).json();
    assert.equal(outreach.tenant, tenant);
    assert.ok(Array.isArray(outreach.attempts) && outreach.attempts.length > 0);
    for (const attempt of outreach.attempts) {
      assert.equal(typeof attempt.channel, 'string');
      assert.equal(typeof attempt.creator, 'string');
      assert.match(attempt.consentRef, /^ref:/);
    }

    const funnel = await (await fetch(`${base}/api/analytics/funnel`, { headers })).json();
    assert.equal(funnel.tenant, tenant);
    assert.equal(typeof funnel.window, 'string');
    assert.equal(typeof funnel.attributionModel, 'string');
    assert.ok(Array.isArray(funnel.stages) && funnel.stages.length >= 3);
    for (const stage of funnel.stages) {
      assert.equal(typeof stage.stage, 'string');
      assert.equal(typeof stage.events, 'number');
    }
    assert.equal(typeof funnel.totals.orders, 'number');
    assert.equal(typeof funnel.totals.gmvMinor, 'number');
    assert.match(funnel.totals.settlementRef, /^ref:/);

    for (const payload of [audit, billing, outreach, funnel]) {
      assertOnlyReferenceSecrets(payload);
    }
  });
});

test('approve happy path mutates fixture state and later GETs reflect the decision', async () => {
  await withServer(async (base) => {
    const tenant = 'tenant-northwind';
    const jsonHeaders = { 'x-tenant-id': tenant, 'x-zaff-csrf': '1', 'content-type': 'application/json' };

    const before = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers: { 'x-tenant-id': tenant } })).json();
    assert.ok(before.approvals.some((approval) => approval.id === 'apr-1002'));

    const decision = await fetch(`${base}/api/workflow/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ approvalId: 'apr-1002', decision: 'approve' })
    });
    assert.equal(decision.status, 200);
    const decided = await decision.json();
    assert.equal(decided.ok, true);
    assert.equal(decided.approval.id, 'apr-1002');
    assert.equal(decided.approval.status, 'approved');
    assert.equal(decided.approval.decidedBy, `op://${tenant}`);

    const after = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers: { 'x-tenant-id': tenant } })).json();
    assert.equal(after.approvals.some((approval) => approval.id === 'apr-1002'), false);
    assert.ok(after.approvals.some((approval) => approval.id === 'apr-1001'));

    const replay = await fetch(`${base}/api/workflow/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ approvalId: 'apr-1002', decision: 'approve' })
    });
    assert.equal(replay.status, 409);

    const rejection = await fetch(`${base}/api/workflow/approve`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ approvalId: 'apr-1003', decision: 'reject' })
    });
    assert.equal(rejection.status, 200);
    assert.equal((await rejection.json()).approval.status, 'rejected');

    const afterReject = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers: { 'x-tenant-id': tenant } })).json();
    assert.equal(afterReject.approvals.some((approval) => approval.id === 'apr-1003'), false);
  });
});

test('approve decisions fail closed: invalid bodies 400, unknown id 404, state untouched', async () => {
  await withServer(async (base) => {
    const headers = { 'x-tenant-id': 'tenant-acme', 'x-zaff-csrf': '1', 'content-type': 'application/json' };
    const pendingBefore = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers: { 'x-tenant-id': 'tenant-acme' } })).json();
    const invalidBodies = [
      { approvalId: 'apr-1001', decision: 'maybe' },
      { approvalId: 'apr-1001', decision: '' },
      { approvalId: 'apr-1001' },
      { decision: 'approve' },
      { approvalId: '', decision: 'approve' },
      { approvalId: 42, decision: 'approve' }
    ];
    for (const body of invalidBodies) {
      const response = await fetch(`${base}/api/workflow/approve`, { method: 'POST', headers, body: JSON.stringify(body) });
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      const payload = await response.json();
      assert.equal(typeof payload.error, 'string');
    }
    assert.equal((await fetch(`${base}/api/workflow/approve`, { method: 'POST', headers, body: '{"approvalId":"apr-1001",' })).status, 400);
    assert.equal((await fetch(`${base}/api/workflow/approve`, { method: 'POST', headers, body: '"just-a-string"' })).status, 400);

    const unknown = await fetch(`${base}/api/workflow/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ approvalId: 'apr-9999', decision: 'approve' })
    });
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'approval_not_found' });

    const pendingAfter = await (await fetch(`${base}/api/workflow/pending-approvals`, { headers: { 'x-tenant-id': 'tenant-acme' } })).json();
    assert.deepEqual(pendingAfter.approvals, pendingBefore.approvals);
  });
});

test('unknown API routes and unsupported methods respond explicitly', async () => {
  await withServer(async (base) => {
    const headers = { 'x-tenant-id': 'tenant-acme' };
    assert.equal((await fetch(`${base}/api/nope`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/api/audit`, { method: 'DELETE', headers })).status, 405);
  });
});

test('index.html is CSP-clean and links all control-plane surfaces', async () => {
  const html = await readFile(join(here, '..', 'apps', 'web', 'public', 'index.html'), 'utf8');

  const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scriptTags.length > 0, 'expected at least one script tag');
  for (const tag of scriptTags) {
    assert.match(tag, /\bsrc\s*=\s*"/i, `inline script without src violates CSP: ${tag}`);
  }
  assert.doesNotMatch(html, /<style[\s>]/i, 'inline style blocks violate style-src');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'style= attributes violate style-src');
  assert.match(html, /<link\s+rel="stylesheet"\s+href="\/styles\.css"\s*\/?>/);

  const navIds = [
    'overview',
    'connections',
    'products',
    'campaigns',
    'creators',
    'links',
    'content',
    'publishing',
    'outreach',
    'workflows',
    'analytics',
    'commissions',
    'billing',
    'audit',
    'security',
    'admin'
  ];
  for (const id of navIds) {
    assert.match(html, new RegExp(`href="#${id}"`), `nav missing surface #${id}`);
  }
  for (const label of [
    'Approval Center',
    'Outreach Center',
    'Attribution Funnel',
    'Commissions',
    'Billing &amp; Usage',
    'Audit Log',
    'Operator Console'
  ]) {
    assert.ok(html.includes(label), `nav missing label ${label}`);
  }
});
