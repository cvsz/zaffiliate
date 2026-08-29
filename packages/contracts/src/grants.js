export const ROLES = Object.freeze({
  OWNER: 'owner',
  ADMIN: 'admin',
  OPERATOR: 'operator',
  ANALYST: 'analyst',
  VIEWER: 'viewer'
});

export const roleRank = Object.freeze({
  owner: 5,
  admin: 4,
  operator: 3,
  analyst: 2,
  viewer: 1
});

const CAPABILITY_PREFIXES = Object.freeze(['manage', 'read', 'execute', 'export']);

const ROLE_GRANTS = Object.freeze({
  owner: Object.freeze(['*']),
  admin: Object.freeze(['manage_*', 'read_*', 'execute_*']),
  operator: Object.freeze(['read_*', 'execute_*']),
  analyst: Object.freeze(['read_*', 'export_*']),
  viewer: Object.freeze(['read_*'])
});

export function capabilitiesFor(role) {
  const normalizedRole = String(role || '').trim();
  if (!Object.prototype.hasOwnProperty.call(ROLE_GRANTS, normalizedRole)) {
    throw new Error(`unknown role: ${normalizedRole}`);
  }
  return ROLE_GRANTS[normalizedRole];
}

function isKnownRole(role) {
  return Object.prototype.hasOwnProperty.call(roleRank, role);
}

function isValidCapability(capability) {
  if (typeof capability !== 'string') return false;
  const separator = capability.indexOf(':');
  if (separator <= 0 || separator === capability.length - 1) return false;
  const prefix = capability.slice(0, separator);
  return CAPABILITY_PREFIXES.includes(prefix) && capability === capability.trim();
}

function matchesCapabilityPattern(pattern, capability) {
  if (pattern === '*') return true;
  if (pattern.endsWith('_*')) return capability.startsWith(pattern.slice(0, -2) + ':');
  return pattern === capability;
}

function requireNonEmptyString(value, label) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

export function createGrantSystem({ assignments = [], clock = () => new Date().toISOString() } = {}) {
  if (!Array.isArray(assignments)) throw new TypeError('assignments must be an array');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const rolesByActor = new Map();
  const escalationAttempts = [];

  function key(tenantId, actorId) {
    return `${tenantId}\u0000${actorId}`;
  }

  function setRole(tenantId, actorId, role) {
    rolesByActor.set(key(tenantId, actorId), role);
  }

  function assignRole(assignment) {
    if (!assignment || typeof assignment !== 'object') throw new TypeError('assignment is required');
    const scopedTenantId = requireNonEmptyString(assignment.tenantId, 'tenantId');
    const scopedActorId = requireNonEmptyString(assignment.actorId, 'actorId');
    const scopedRole = requireNonEmptyString(assignment.role, 'role');
    if (!isKnownRole(scopedRole)) throw new Error(`unknown role: ${scopedRole}`);
    setRole(scopedTenantId, scopedActorId, scopedRole);
    return Object.freeze({ tenantId: scopedTenantId, actorId: scopedActorId, role: scopedRole });
  }

  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== 'object') throw new TypeError('each assignment must be an object');
    assignRole(assignment);
  }

  function roleFor(tenantId, actorId) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    const scopedActorId = requireNonEmptyString(actorId, 'actorId');
    return rolesByActor.get(key(scopedTenantId, scopedActorId)) ?? null;
  }

  function grant(tenantId, actorId, capability) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    const scopedActorId = requireNonEmptyString(actorId, 'actorId');
    if (!isValidCapability(capability)) {
      return Object.freeze({ allowed: false, reason: 'unknown_capability' });
    }
    const role = rolesByActor.get(key(scopedTenantId, scopedActorId));
    if (!role) return Object.freeze({ allowed: false, reason: 'no_role_assigned' });
    if (!isKnownRole(role)) return Object.freeze({ allowed: false, reason: 'unknown_role' });
    const patterns = ROLE_GRANTS[role];
    const allowed = patterns.some((pattern) => matchesCapabilityPattern(pattern, capability));
    return Object.freeze({ allowed, reason: allowed ? 'granted' : 'capability_not_granted' });
  }

  function attemptEscalation({ tenantId, actorId, targetRole } = {}) {
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    const scopedActorId = requireNonEmptyString(actorId, 'actorId');
    const scopedTargetRole = requireNonEmptyString(targetRole, 'targetRole');
    if (!isKnownRole(scopedTargetRole)) throw new Error(`unknown target role: ${scopedTargetRole}`);
    const currentRole = rolesByActor.get(key(scopedTenantId, scopedActorId));
    const allowed = Boolean(
      currentRole &&
      isKnownRole(currentRole) &&
      (currentRole === ROLES.OWNER || currentRole === ROLES.ADMIN) &&
      roleRank[scopedTargetRole] < roleRank[currentRole]
    );
    const attempt = Object.freeze({
      at: clock(),
      tenantId: scopedTenantId,
      actorId: scopedActorId,
      actorRole: currentRole ?? null,
      targetRole: scopedTargetRole,
      allowed,
      reason: allowed ? 'escalation_allowed' : 'escalation_denied'
    });
    escalationAttempts.push(attempt);
    if (allowed) setRole(scopedTenantId, scopedActorId, scopedTargetRole);
    return Object.freeze({ allowed, reason: attempt.reason, attempt });
  }

  function listEscalationAttempts({ tenantId } = {}) {
    if (tenantId == null) return Object.freeze(escalationAttempts.slice());
    const scopedTenantId = requireNonEmptyString(tenantId, 'tenantId');
    return Object.freeze(escalationAttempts.filter((attempt) => attempt.tenantId === scopedTenantId));
  }

  return Object.freeze({ assignRole, roleFor, grant, attemptEscalation, listEscalationAttempts });
}
