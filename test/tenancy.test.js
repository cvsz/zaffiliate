import test from 'node:test';
import assert from 'node:assert/strict';
import { requireTenantContext } from '../packages/contracts/src/index.js';
import { Actions, requireScopedResource, authorizeTenantAccess, requireAuthorizedTenantAccess, createAuditEvent } from '../packages/contracts/src/tenancy.js';

test('same-tenant access is allowed', () => {
  const context = requireTenantContext({ tenantId: 'tenant-a', actorId: 'user-1' });
  const resource = requireScopedResource({ tenantId: 'tenant-a', resourceId: 'campaign-1', resourceType: 'campaign' });
  const decision = authorizeTenantAccess({ context, resource, action: Actions.READ });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'tenant_match');
});

test('cross-tenant access is denied fail-closed', () => {
  const context = requireTenantContext({ tenantId: 'tenant-a', actorId: 'user-1' });
  const resource = requireScopedResource({ tenantId: 'tenant-b', resourceId: 'campaign-2', resourceType: 'campaign' });
  const decision = authorizeTenantAccess({ context, resource, action: Actions.WRITE });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'cross_tenant_denied');
  assert.throws(() => requireAuthorizedTenantAccess({ context, resource, action: Actions.WRITE }), (error) => error.code === 'CROSS_TENANT_DENIED');
});

test('audit event binds actor tenant resource action and outcome', () => {
  const context = requireTenantContext({ tenantId: 'tenant-a', actorId: 'user-1' });
  const resource = requireScopedResource({ tenantId: 'tenant-a', resourceId: 'product-1', resourceType: 'product' });
  const decision = authorizeTenantAccess({ context, resource, action: Actions.ADMIN });
  const event = createAuditEvent({ context, resource, decision, action: Actions.ADMIN, requestId: 'req-123', occurredAt: '2026-08-22T04:17:00.000Z' });
  assert.deepEqual(event, {
    version: 1,
    occurredAt: '2026-08-22T04:17:00.000Z',
    requestId: 'req-123',
    tenantId: 'tenant-a',
    actorId: 'user-1',
    action: 'admin',
    resourceType: 'product',
    resourceId: 'product-1',
    outcome: 'allowed',
    reason: 'tenant_match'
  });
});
