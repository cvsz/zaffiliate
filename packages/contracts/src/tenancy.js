export const Actions = Object.freeze({ READ: 'read', WRITE: 'write', ADMIN: 'admin' });

export function requireScopedResource(input) {
  if (!input || typeof input !== 'object') throw new TypeError('resource is required');
  const tenantId = String(input.tenantId || '').trim();
  const resourceId = String(input.resourceId || '').trim();
  const resourceType = String(input.resourceType || '').trim();
  if (!tenantId) throw new Error('tenantId is required');
  if (!resourceId) throw new Error('resourceId is required');
  if (!resourceType) throw new Error('resourceType is required');
  return Object.freeze({ tenantId, resourceId, resourceType });
}

export function authorizeTenantAccess({ context, resource, action = Actions.READ }) {
  if (!context || !resource) throw new TypeError('context and resource are required');
  if (!Object.values(Actions).includes(action)) throw new Error('unsupported action');
  const allowed = context.tenantId === resource.tenantId;
  return Object.freeze({
    allowed,
    reason: allowed ? 'tenant_match' : 'cross_tenant_denied',
    tenantId: context.tenantId,
    actorId: context.actorId,
    resourceId: resource.resourceId,
    action
  });
}

export function requireAuthorizedTenantAccess(input) {
  const decision = authorizeTenantAccess(input);
  if (!decision.allowed) {
    const error = new Error('cross-tenant access denied');
    error.code = 'CROSS_TENANT_DENIED';
    error.decision = decision;
    throw error;
  }
  return decision;
}

export function createAuditEvent({ context, action, resource, decision, requestId, occurredAt = new Date().toISOString() }) {
  if (!context || !resource || !decision) throw new TypeError('context, resource and decision are required');
  if (decision.actorId !== context.actorId || decision.tenantId !== context.tenantId) throw new Error('decision/context mismatch');
  return Object.freeze({
    version: 1,
    occurredAt,
    requestId: String(requestId || '').trim() || null,
    tenantId: context.tenantId,
    actorId: context.actorId,
    action: String(action || decision.action || '').trim(),
    resourceType: resource.resourceType,
    resourceId: resource.resourceId,
    outcome: decision.allowed ? 'allowed' : 'denied',
    reason: decision.reason
  });
}
