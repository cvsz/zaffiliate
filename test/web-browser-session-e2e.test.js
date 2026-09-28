import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebServer } from '../apps/web/server.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function sessionBridge(role = 'owner', { active = true } = {}) {
  return {
    peekTenant(req) {
      return String(req.headers.cookie ?? '').includes('session=ok') ? TENANT : null;
    },
    async resolve(req) {
      if (!active || !String(req.headers.cookie ?? '').includes('session=ok')) return null;
      return {
        tenantId: TENANT,
        token: 'zs_browser_session',
        session: { expiresAt: new Date(Date.now() + 60000).toISOString(), user: { tenantId: TENANT, userId: 'user-1', email: 'owner@example.test', role } }
      };
    },
    async login() { throw new Error('not used'); },
    async logout() { return { status: 200, body: { ok: true }, headers: { 'set-cookie': [] } }; }
  };
}

function providers(overrides = {}) {
  return {
    analyticsSummary: async () => ({ currency: 'THB', netCommissionMinorUnits: 100, pendingCommissionMinorUnits: 0, conversions: 1, clicks: 2 }),
    publishedContentCount: async () => 1,
    pendingApprovals: async () => [{ id: '33333333-3333-4333-8333-333333333333', kind: 'publish', title: 'video', requestedBy: 'user-2', impactMinor: 0, status: 'pending' }],
    decideApproval: async (input) => ({ status: 200, approval: { id: 'apr-real', status: input.decision === 'approve' ? 'approved' : 'rejected' } }),
    ...overrides
  };
}

test('expired or revoked browser session is rejected before tenant data access', async (t) => {
  const server = buildWebServer({ appEnv: 'production', sessionBridge: sessionBridge('owner', { active: false }), dataProviders: providers() });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/ui/overview`, { headers: { cookie: 'session=ok' } });
  assert.equal(response.status, 401);
});

test('viewer session cannot approve durable workflow even with a valid CSRF token', async (t) => {
  const server = buildWebServer({ appEnv: 'production', sessionBridge: sessionBridge('viewer'), dataProviders: providers() });
  t.after(() => server.close());
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const csrfResponse = await fetch(base + '/api/csrf-token', { headers: { cookie: 'session=ok' } });
  assert.equal(csrfResponse.status, 200);
  const csrf = (await csrfResponse.json()).token;
  const denied = await fetch(base + '/api/workflow/approve', {
    method: 'POST',
    headers: { cookie: 'session=ok', 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ approvalId: '33333333-3333-4333-8333-333333333333', decision: 'approve' })
  });
  assert.equal(denied.status, 403);
});

test('owner approval is bound to session CSRF and persisted through the injected durable provider', async (t) => {
  let received = null;
  const server = buildWebServer({
    appEnv: 'production',
    sessionBridge: sessionBridge('owner'),
    dataProviders: providers({ decideApproval: async (input) => {
      received = input;
      return { status: 200, approval: { id: 'apr-real', status: 'approved' } };
    } })
  });
  t.after(() => server.close());
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const missingCsrf = await fetch(base + '/api/workflow/approve', {
    method: 'POST',
    headers: { cookie: 'session=ok', 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: '33333333-3333-4333-8333-333333333333', decision: 'approve' })
  });
  assert.equal(missingCsrf.status, 403);

  const csrf = await (await fetch(base + '/api/csrf-token', { headers: { cookie: 'session=ok' } })).json();
  const approved = await fetch(base + '/api/workflow/approve', {
    method: 'POST',
    headers: { cookie: 'session=ok', 'content-type': 'application/json', 'x-csrf-token': csrf.token },
    body: JSON.stringify({ approvalId: '33333333-3333-4333-8333-333333333333', decision: 'approve' })
  });
  assert.equal(approved.status, 200);
  assert.deepEqual(received, {
    tenantId: TENANT,
    jobId: '33333333-3333-4333-8333-333333333333',
    userId: 'user-1',
    decision: 'approve'
  });
});

test('session tenant cannot be switched with x-tenant-id header', async (t) => {
  const server = buildWebServer({ appEnv: 'production', sessionBridge: sessionBridge('owner'), dataProviders: providers() });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/ui/overview`, {
    headers: { cookie: 'session=ok', 'x-tenant-id': '22222222-2222-4222-8222-222222222222' }
  });
  assert.equal(response.status, 403);
});
