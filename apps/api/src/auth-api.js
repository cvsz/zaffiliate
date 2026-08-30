import { createHash } from 'node:crypto';
import { canRole } from '../../../packages/security/src/rbac.js';
import { LocalAuthError } from './auth-service.js';

const AUTH_PREFIX = '/api/v1/auth/';
const MAX_BODY_BYTES = 16 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(headers = {}) {
  const value = String(headers.authorization ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new LocalAuthError(413, 'PAYLOAD_TOO_LARGE', 'request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new LocalAuthError(400, 'INVALID_JSON', 'request body must be valid JSON'); }
}

function requireTenant(tenantId) {
  const value = String(tenantId ?? '').trim();
  if (!value) throw new LocalAuthError(400, 'TENANT_HEADER_REQUIRED', 'x-tenant-id header is required');
  if (!UUID_PATTERN.test(value)) throw new LocalAuthError(400, 'TENANT_ID_INVALID', 'x-tenant-id must be a UUID');
  return value.toLowerCase();
}

function queryLimit(req) {
  const raw = new URL(req?.url || '/', 'http://localhost').searchParams.get('limit');
  if (raw == null || raw === '') return 50;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new LocalAuthError(400, 'LIMIT_INVALID', 'limit must be a positive integer');
  return Math.min(limit, 100);
}

async function requireSessionForAction(service, req, tenantId, action) {
  const session = await service.getSession({ tenantId, token: bearerToken(req.headers) });
  if (!session) throw new LocalAuthError(401, 'UNAUTHENTICATED', 'authentication required');
  if (session.user?.tenantId !== tenantId) throw new LocalAuthError(403, 'FORBIDDEN', 'cross-tenant access denied');
  if (!canRole(session.user?.role, action)) throw new LocalAuthError(403, 'FORBIDDEN', 'role is not permitted for this action');
  return session;
}

async function limit(rateLimiter, key) {
  const verdict = await rateLimiter.tryAcquire(key);
  if (!verdict.allowed) {
    return {
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
      headers: { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1) }
    };
  }
  return null;
}

function errorResult(error) {
  if (error instanceof LocalAuthError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: 'AUTH_INTERNAL', message: 'unexpected authentication failure' } } };
}

export function createLocalAuthApi({ service, rateLimiter } = {}) {
  if (!service || typeof service.login !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rateLimiter is required');

  return Object.freeze({
    async handle({ req, pathname, tenantId } = {}) {
      if (!String(pathname ?? '').startsWith(AUTH_PREFIX)) return null;
      const method = String(req?.method ?? 'GET').toUpperCase();
      const ip = String(req?.socket?.remoteAddress ?? 'unknown');
      try {
        if (pathname === '/api/v1/auth/register' && method === 'POST') {
          const throttled = await limit(rateLimiter, `auth:register:${ip}`);
          if (throttled) return throttled;
          const user = await service.register(await readJson(req));
          return { status: 201, body: { user } };
        }

        if (pathname === '/api/v1/auth/login' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          const throttled = await limit(rateLimiter, `auth:login:${scopedTenant}:${ip}`);
          if (throttled) return throttled;
          const body = await readJson(req);
          const result = await service.login({ tenantId: scopedTenant, email: body.email, password: body.password });
          return { status: 200, body: result, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/logout' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          await service.logout({ tenantId: scopedTenant, token: bearerToken(req.headers) });
          return { status: 200, body: { ok: true }, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/me' && method === 'GET') {
          const scopedTenant = requireTenant(tenantId);
          const session = await service.getSession({ tenantId: scopedTenant, token: bearerToken(req.headers) });
          if (!session) throw new LocalAuthError(401, 'UNAUTHENTICATED', 'authentication required');
          return { status: 200, body: session, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/users' && method === 'GET') {
          const scopedTenant = requireTenant(tenantId);
          await requireSessionForAction(service, req, scopedTenant, 'user:list');
          const users = await service.listTenantUsers({ tenantId: scopedTenant, limit: queryLimit(req) });
          return { status: 200, body: { users }, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/audit' && method === 'GET') {
          const scopedTenant = requireTenant(tenantId);
          await requireSessionForAction(service, req, scopedTenant, 'audit:read');
          const events = await service.listAuditEvents({ tenantId: scopedTenant, limit: queryLimit(req) });
          return { status: 200, body: { events }, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/password-reset/request' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          const body = await readJson(req);
          const emailKey = createHash('sha256').update(String(body.email ?? '').trim().toLowerCase()).digest('hex');
          const throttled = await limit(rateLimiter, `auth:reset:${scopedTenant}:${emailKey}`);
          if (throttled) return throttled;
          await service.requestPasswordReset({ tenantId: scopedTenant, email: body.email });
          return { status: 202, body: { accepted: true }, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/password-reset/confirm' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          const body = await readJson(req);
          const throttled = await limit(rateLimiter, `auth:reset-confirm:${scopedTenant}:${ip}`);
          if (throttled) return throttled;
          const result = await service.resetPassword({ tenantId: scopedTenant, token: body.token, newPassword: body.newPassword });
          return { status: 200, body: result, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/email-verification/request' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          const session = await service.getSession({ tenantId: scopedTenant, token: bearerToken(req.headers) });
          if (!session) throw new LocalAuthError(401, 'UNAUTHENTICATED', 'authentication required');
          const throttled = await limit(rateLimiter, `auth:verify:${scopedTenant}:${session.user.userId}`);
          if (throttled) return throttled;
          const result = await service.requestEmailVerification({ tenantId: scopedTenant, userId: session.user.userId });
          return { status: 202, body: result, headers: { 'cache-control': 'no-store' } };
        }

        if (pathname === '/api/v1/auth/email-verification/confirm' && method === 'POST') {
          const scopedTenant = requireTenant(tenantId);
          const body = await readJson(req);
          const result = await service.confirmEmailVerification({ tenantId: scopedTenant, token: body.token });
          return { status: 200, body: result, headers: { 'cache-control': 'no-store' } };
        }

        return { status: 404, body: { error: { code: 'AUTH_ROUTE_NOT_FOUND', message: 'auth route not found' } } };
      } catch (error) {
        return errorResult(error);
      }
    }
  });
}
