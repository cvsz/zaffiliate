import { canRole } from '../../../packages/security/src/rbac.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROTECTED_PREFIXES = [
  '/api/v1/commerce/',
  '/api/v1/intelligence/',
  '/api/v1/analytics/',
  '/api/v1/automation/',
  '/api/v1/content/'
];

function bearerToken(headers = {}) {
  const value = String(headers.authorization ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

function requiredAction(pathname, method) {
  const verb = String(method ?? 'GET').toUpperCase();
  if (verb === 'GET' && pathname === '/api/v1/commerce/offers') return 'commerce:read';
  if (verb === 'GET' && pathname === '/api/v1/analytics/overview') return 'analytics:read';
  if (verb === 'GET' && pathname === '/api/v1/intelligence/opportunities/rank') return 'intelligence:read';
  if (verb === 'GET' && pathname === '/api/v1/intelligence/recommendations') return 'intelligence:read';
  if (verb === 'POST' && /^\/api\/v1\/intelligence\/recommendations\/[^/]+\/feedback$/.test(pathname)) return 'intelligence:feedback';
  if (verb === 'POST' && pathname === '/api/v1/intelligence/gate') return 'intelligence:execute';
  if (verb === 'GET' && pathname === '/api/v1/automation/status') return 'automation:read';
  if (verb === 'POST' && pathname === '/api/v1/automation/kill-switch') return 'automation:write';
  if (verb === 'PUT' && pathname === '/api/v1/automation/policy') return 'automation:write';
  if (verb === 'GET' && pathname === '/api/v1/content/personas') return 'content:read';
  if (verb === 'POST' && ['/api/v1/content/briefs', '/api/v1/content/hooks', '/api/v1/content/score'].includes(pathname)) return 'content:write';
  return 'tenant:read';
}

export function isProtectedBusinessPath(pathname) {
  const path = String(pathname ?? '');
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function createProductionAuthorization({ localAuthService } = {}) {
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');

  return Object.freeze({
    async authorize({ req, pathname, tenantHeader = '' } = {}) {
      if (!isProtectedBusinessPath(pathname)) return { protected: false, allowed: true, principal: null };
      const tenantId = String(tenantHeader ?? '').trim().toLowerCase();
      if (!tenantId) {
        return { protected: true, allowed: false, result: { status: 400, body: { error: { code: 'TENANT_HEADER_REQUIRED', message: 'x-tenant-id header is required' } } } };
      }
      if (!UUID_PATTERN.test(tenantId)) {
        return { protected: true, allowed: false, result: { status: 400, body: { error: { code: 'TENANT_ID_INVALID', message: 'x-tenant-id must be a UUID' } } } };
      }
      const token = bearerToken(req?.headers);
      if (!token) {
        return { protected: true, allowed: false, result: { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } } } };
      }
      const session = await localAuthService.getSession({ tenantId, token });
      if (!session || session.user?.tenantId !== tenantId) {
        return { protected: true, allowed: false, result: { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } } } };
      }
      const action = requiredAction(String(pathname ?? ''), req?.method);
      if (!canRole(session.user.role, action)) {
        return { protected: true, allowed: false, result: { status: 403, body: { error: { code: 'FORBIDDEN', message: 'role is not permitted for this action' } } } };
      }
      return {
        protected: true,
        allowed: true,
        action,
        principal: Object.freeze({ tenantId, userId: session.user.userId, role: session.user.role })
      };
    }
  });
}
