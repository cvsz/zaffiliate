const ACTION_ROLES = Object.freeze({
  'tenant:read': Object.freeze(['owner', 'admin', 'operator', 'affiliate', 'viewer']),
  'commerce:read': Object.freeze(['owner', 'admin', 'operator', 'affiliate', 'viewer']),
  'analytics:read': Object.freeze(['owner', 'admin', 'operator', 'affiliate', 'viewer']),
  'intelligence:read': Object.freeze(['owner', 'admin', 'operator', 'affiliate', 'viewer']),
  'intelligence:feedback': Object.freeze(['owner', 'admin', 'operator']),
  'intelligence:execute': Object.freeze(['owner', 'admin', 'operator']),
  'automation:read': Object.freeze(['owner', 'admin', 'operator']),
  'automation:write': Object.freeze(['owner', 'admin']),
  'content:read': Object.freeze(['owner', 'admin', 'operator', 'affiliate', 'viewer']),
  'content:write': Object.freeze(['owner', 'admin', 'operator', 'affiliate']),
  'user:list': Object.freeze(['owner', 'admin', 'operator']),
  'audit:read': Object.freeze(['owner', 'admin']),
  'tenant:admin': Object.freeze(['owner'])
});

export const AUTHZ_ACTIONS = Object.freeze(Object.keys(ACTION_ROLES));

export function canRole(role, action) {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  const normalizedAction = String(action ?? '').trim().toLowerCase();
  const allowed = ACTION_ROLES[normalizedAction];
  if (!allowed || !normalizedRole) return false;
  return allowed.includes(normalizedRole);
}

export function requireRoleAction(role, action) {
  if (!AUTHZ_ACTIONS.includes(String(action ?? '').trim().toLowerCase())) {
    const error = new Error('unknown authorization action');
    error.code = 'AUTHZ_ACTION_UNKNOWN';
    throw error;
  }
  if (!canRole(role, action)) {
    const error = new Error('role is not permitted to perform this action');
    error.code = 'FORBIDDEN';
    error.status = 403;
    throw error;
  }
  return true;
}
