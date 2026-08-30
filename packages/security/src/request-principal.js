import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

function normalizedPrincipal(principal) {
  if (!principal || typeof principal !== 'object') throw new TypeError('principal object is required');
  const tenantId = String(principal.tenantId ?? '').trim();
  const userId = String(principal.userId ?? '').trim();
  const role = String(principal.role ?? '').trim().toLowerCase();
  if (!tenantId || !userId || !role) throw new TypeError('principal tenantId, userId and role are required');
  return Object.freeze({ tenantId, userId, role });
}

export function runWithRequestPrincipal(principal, fn) {
  if (typeof fn !== 'function') throw new TypeError('principal callback is required');
  return storage.run(normalizedPrincipal(principal), fn);
}

export function getRequestPrincipal() {
  return storage.getStore() ?? null;
}
