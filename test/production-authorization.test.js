import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionAuthorization, isProtectedBusinessPath } from '../apps/api/src/production-authorization.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function req(method, token = '') {
  return { method, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function service() {
  return {
    async getSession({ tenantId, token }) {
      const roles = {
        owner: 'owner', admin: 'admin', operator: 'operator', affiliate: 'affiliate', viewer: 'viewer', service: 'service'
      };
      const role = roles[token];
      if (!role) return null;
      return { user: { tenantId, userId: `usr_${role}`, role } };
    }
  };
}

test('protected path classifier excludes public/provider-authenticated routes', () => {
  assert.equal(isProtectedBusinessPath('/api/v1/commerce/offers'), true);
  assert.equal(isProtectedBusinessPath('/api/v1/content/personas'), true);
  assert.equal(isProtectedBusinessPath('/go/abc'), false);
  assert.equal(isProtectedBusinessPath('/webhooks/tiktok'), false);
  assert.equal(isProtectedBusinessPath('/healthz'), false);
});

test('production authorization requires valid tenant and bearer session', async () => {
  const authz = createProductionAuthorization({ localAuthService: service() });
  const missingTenant = await authz.authorize({ req: req('GET', 'viewer'), pathname: '/api/v1/commerce/offers', tenantHeader: '' });
  assert.equal(missingTenant.result.status, 400);
  assert.equal(missingTenant.result.body.error.code, 'TENANT_HEADER_REQUIRED');

  const malformedTenant = await authz.authorize({ req: req('GET', 'viewer'), pathname: '/api/v1/commerce/offers', tenantHeader: 'tenant-a' });
  assert.equal(malformedTenant.result.status, 400);
  assert.equal(malformedTenant.result.body.error.code, 'TENANT_ID_INVALID');

  const anonymous = await authz.authorize({ req: req('GET'), pathname: '/api/v1/commerce/offers', tenantHeader: TENANT });
  assert.equal(anonymous.result.status, 401);
});

test('read and write permissions are explicit and service role fails closed', async () => {
  const authz = createProductionAuthorization({ localAuthService: service() });
  const viewerRead = await authz.authorize({ req: req('GET', 'viewer'), pathname: '/api/v1/analytics/overview', tenantHeader: TENANT });
  assert.equal(viewerRead.allowed, true);
  assert.equal(viewerRead.action, 'analytics:read');
  assert.deepEqual(viewerRead.principal, { tenantId: TENANT, userId: 'usr_viewer', role: 'viewer' });

  const viewerWrite = await authz.authorize({ req: req('PUT', 'viewer'), pathname: '/api/v1/automation/policy', tenantHeader: TENANT });
  assert.equal(viewerWrite.result.status, 403);

  const adminWrite = await authz.authorize({ req: req('PUT', 'admin'), pathname: '/api/v1/automation/policy', tenantHeader: TENANT });
  assert.equal(adminWrite.allowed, true);
  assert.equal(adminWrite.action, 'automation:write');

  const serviceRead = await authz.authorize({ req: req('GET', 'service'), pathname: '/api/v1/commerce/offers', tenantHeader: TENANT });
  assert.equal(serviceRead.result.status, 403);
});
