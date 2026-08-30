import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAuthApi } from '../apps/api/src/auth-api.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function service() {
  const calls = [];
  return {
    calls,
    async login() { throw new Error('unused'); },
    async getSession({ tenantId, token }) {
      const roles = { zs_owner: 'owner', zs_admin: 'admin', zs_operator: 'operator', zs_viewer: 'viewer', zs_service: 'service' };
      const role = roles[token];
      if (!role) return null;
      return { user: { tenantId, userId: `usr_${role}`, email: `${role}@example.test`, role } };
    },
    async listTenantUsers(input) {
      calls.push(['users', input]);
      return [{ tenantId: input.tenantId, userId: 'usr_member', email: 'member@example.test', role: 'viewer', emailVerified: true, createdAt: new Date(0) }];
    },
    async listAuditEvents(input) {
      calls.push(['audit', input]);
      return [{ id: 1, tenantId: input.tenantId, actorId: 'usr_admin', action: 'auth.login', outcome: 'allowed' }];
    }
  };
}

function request(path, token) {
  return {
    method: 'GET',
    url: path,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '127.0.0.1' }
  };
}

test('operator can list tenant users but viewer cannot', async () => {
  const svc = service();
  const api = createLocalAuthApi({ service: svc, rateLimiter: limiter() });
  const allowed = await api.handle({ req: request('/api/v1/auth/users?limit=25', 'zs_operator'), pathname: '/api/v1/auth/users', tenantId: TENANT });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.users[0].email, 'member@example.test');
  assert.deepEqual(svc.calls[0], ['users', { tenantId: TENANT, limit: 25 }]);

  const denied = await api.handle({ req: request('/api/v1/auth/users', 'zs_viewer'), pathname: '/api/v1/auth/users', tenantId: TENANT });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
});

test('audit requires admin/owner and caps result limit', async () => {
  const svc = service();
  const api = createLocalAuthApi({ service: svc, rateLimiter: limiter() });
  const denied = await api.handle({ req: request('/api/v1/auth/audit', 'zs_operator'), pathname: '/api/v1/auth/audit', tenantId: TENANT });
  assert.equal(denied.status, 403);

  const allowed = await api.handle({ req: request('/api/v1/auth/audit?limit=999', 'zs_admin'), pathname: '/api/v1/auth/audit', tenantId: TENANT });
  assert.equal(allowed.status, 200);
  assert.deepEqual(svc.calls.at(-1), ['audit', { tenantId: TENANT, limit: 100 }]);
});

test('protected auth reads reject anonymous and service sessions', async () => {
  const api = createLocalAuthApi({ service: service(), rateLimiter: limiter() });
  const anonymous = await api.handle({ req: request('/api/v1/auth/users', ''), pathname: '/api/v1/auth/users', tenantId: TENANT });
  assert.equal(anonymous.status, 401);
  const serviceRole = await api.handle({ req: request('/api/v1/auth/audit', 'zs_service'), pathname: '/api/v1/auth/audit', tenantId: TENANT });
  assert.equal(serviceRole.status, 403);
});
