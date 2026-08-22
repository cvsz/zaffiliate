function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const Roles = Object.freeze(['owner','admin','operator','affiliate','viewer','service']);

export function createMembership({ tenantId, userId, role }) {
  const normalizedRole = required(role, 'role').toLowerCase();
  if (!Roles.includes(normalizedRole)) throw new Error('unsupported role');
  return Object.freeze({ tenantId: required(tenantId, 'tenantId'), userId: required(userId, 'userId'), role: normalizedRole });
}

export function authorizeRole({ membership, tenantId, allowedRoles }) {
  if (!membership || membership.tenantId !== tenantId) return Object.freeze({ allowed: false, reason: 'tenant_mismatch' });
  const allowed = new Set((allowedRoles || []).map((role) => String(role).toLowerCase()));
  return Object.freeze({ allowed: allowed.has(membership.role), reason: allowed.has(membership.role) ? 'role_allowed' : 'role_denied' });
}

export function createApiKeyMetadata({ tenantId, keyId, actorId, scopes, expiresAt = null }) {
  const normalizedScopes = [...new Set((scopes || []).map((scope) => required(scope, 'scope').toLowerCase()))].sort();
  if (!normalizedScopes.length) throw new Error('at least one scope is required');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    keyId: required(keyId, 'keyId'),
    actorId: required(actorId, 'actorId'),
    scopes: Object.freeze(normalizedScopes),
    expiresAt: expiresAt == null ? null : new Date(expiresAt).toISOString()
  });
}

export function requireApiScope({ apiKey, tenantId, scope, now = new Date() }) {
  if (!apiKey || apiKey.tenantId !== tenantId) throw Object.assign(new Error('API key tenant mismatch'), { code: 'API_KEY_TENANT_MISMATCH' });
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= now.getTime()) throw Object.assign(new Error('API key expired'), { code: 'API_KEY_EXPIRED' });
  if (!apiKey.scopes.includes(String(scope).toLowerCase())) throw Object.assign(new Error('API scope denied'), { code: 'API_SCOPE_DENIED' });
  return true;
}

export function createPlan({ planId, quotas = {}, features = [] }) {
  const normalizedQuotas = {};
  for (const [key, value] of Object.entries(quotas)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid quota: ${key}`);
    normalizedQuotas[key] = n;
  }
  return Object.freeze({ planId: required(planId, 'planId'), quotas: Object.freeze(normalizedQuotas), features: Object.freeze([...new Set(features.map(String))].sort()) });
}

export function checkQuota({ plan, metric, used, requested = 1 }) {
  const limit = plan?.quotas?.[metric];
  if (limit == null) return Object.freeze({ allowed: false, reason: 'quota_undefined', limit: null, remaining: 0 });
  const next = Number(used) + Number(requested);
  const allowed = Number.isFinite(next) && next <= limit;
  return Object.freeze({ allowed, reason: allowed ? 'within_quota' : 'quota_exceeded', limit, remaining: Math.max(0, limit - Number(used || 0)) });
}

export function createLedgerTransaction({ tenantId, transactionId, currency, entries, referenceType, referenceId, occurredAt = new Date().toISOString() }) {
  if (!Array.isArray(entries) || entries.length < 2) throw new Error('ledger transaction requires at least two entries');
  const normalized = entries.map((entry) => Object.freeze({
    account: required(entry.account, 'account'),
    debit: Number(entry.debit || 0),
    credit: Number(entry.credit || 0)
  }));
  for (const entry of normalized) {
    if (entry.debit < 0 || entry.credit < 0 || !Number.isFinite(entry.debit) || !Number.isFinite(entry.credit)) throw new Error('invalid ledger amount');
    if (entry.debit > 0 && entry.credit > 0) throw new Error('ledger entry cannot debit and credit simultaneously');
  }
  const debits = normalized.reduce((sum, entry) => sum + entry.debit, 0);
  const credits = normalized.reduce((sum, entry) => sum + entry.credit, 0);
  if (Math.abs(debits - credits) > 1e-9) throw new Error('ledger transaction is not balanced');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    transactionId: required(transactionId, 'transactionId'),
    currency: required(currency, 'currency').toUpperCase(),
    referenceType: required(referenceType, 'referenceType'),
    referenceId: required(referenceId, 'referenceId'),
    occurredAt: new Date(occurredAt).toISOString(),
    entries: Object.freeze(normalized),
    total: debits
  });
}
