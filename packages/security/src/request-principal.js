const principals = new WeakMap();

export function setRequestPrincipal(request, principal) {
  if (!request || (typeof request !== 'object' && typeof request !== 'function')) throw new TypeError('request object is required');
  if (!principal || typeof principal !== 'object') throw new TypeError('principal object is required');
  principals.set(request, Object.freeze({
    tenantId: String(principal.tenantId ?? ''),
    userId: String(principal.userId ?? ''),
    role: String(principal.role ?? '')
  }));
}

export function getRequestPrincipal(request) {
  return principals.get(request) ?? null;
}
