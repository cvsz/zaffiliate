import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebServer } from '../apps/web/server.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const URLS = ['/api/csrf-token', '/api/ui/overview', '/api/audit', '/api/workflow/pending-approvals'];

async function withServer(t, options = {}) {
  const server = buildWebServer({ appEnv: 'production', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function authorization(tenant = TENANT, token = 'zs_test-token') {
  return { 'x-tenant-id': tenant, authorization: `Bearer ${token}` };
}

test('production refuses unauthenticated requests to all sensitive surfaces', async (t) => {
  const url = await withServer(t, { authenticate: async () => { throw new Error('must not run'); } });
  for (const path of URLS) {
    const response = await fetch(url + path, { headers: { 'x-tenant-id': TENANT } });
    assert.equal(response.status, 401, path);
  }
  const health = await fetch(url + '/healthz');
  assert.equal(health.status, 200);
});

test('production rejects forged tenant header even with an otherwise valid session', async (t) => {
  const url = await withServer(t, {
    authenticate: async () => ({ user: { tenantId: TENANT, userId: 'user-1', role: 'owner' } })
  });
  const response = await fetch(url + '/api/ui/overview', { headers: authorization(OTHER) });
  assert.equal(response.status, 401);
});

test('production fails closed when backend authentication is unavailable', async (t) => {
  const url = await withServer(t, { authenticate: async () => { throw new Error('offline'); } });
  const response = await fetch(url + '/api/csrf-token', { headers: authorization() });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'authentication_unavailable');
});

test('production issues CSRF only to a session verified for the selected tenant', async (t) => {
  const url = await withServer(t, {
    authenticate: async ({ tenantId, token }) => {
      assert.equal(tenantId, TENANT);
      assert.equal(token, 'zs_test-token');
      return { user: { tenantId, userId: 'user-1', role: 'owner' } };
    }
  });
  const response = await fetch(url + '/api/csrf-token', { headers: authorization() });
  assert.equal(response.status, 200);
  assert.ok((await response.json()).token);
});

test('production never substitutes fixture approvals, revenue or worker status', async (t) => {
  const url = await withServer(t, {
    authenticate: async () => ({ user: { tenantId: TENANT, userId: 'user-1', role: 'owner' } })
  });
  for (const path of ['/api/ui/revenue-trend', '/api/ui/worker-health', '/api/workflow/pending-approvals', '/api/ui/overview']) {
    const response = await fetch(url + path, { headers: authorization() });
    assert.equal(response.status, 503, path);
  }
  const approval = await fetch(url + '/api/workflow/approve', {
    method: 'POST',
    headers: { ...authorization(), 'content-type': 'application/json' },
    body: JSON.stringify({ approvalId: 'apr-1001', decision: 'approve' })
  });
  assert.equal(approval.status, 503);
});
