const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const WRITE_ROLES = new Set(['owner', 'admin']);

function tenantId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) {
    const error = new Error('valid UUID x-tenant-id header is required');
    error.status = 400; error.code = 'TENANT_HEADER_INVALID'; throw error;
  }
  return id;
}
function bearerToken(headers = {}) {
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
  return m ? m[1].trim() : '';
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk); size += b.length;
    if (size > MAX_BODY_BYTES) { const e = new Error('request body too large'); e.status = 413; e.code = 'BODY_TOO_LARGE'; throw e; }
    chunks.push(b);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!v || Array.isArray(v) || typeof v !== 'object') throw new Error('object required');
    return v;
  } catch { const e = new Error('request body must be a JSON object'); e.status = 400; e.code = 'INVALID_JSON'; throw e; }
}
async function limited(rateLimiter, key) {
  const verdict = await rateLimiter.tryAcquire(key);
  if (verdict.allowed) return null;
  return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } }, headers: { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1), 'cache-control': 'no-store' } };
}
function safeFailure(error) {
  const code = String(error?.code ?? 'PUBLICATION_REQUEST_FAILED');
  if (code === 'PUBLICATION_TRANSITION_ILLEGAL') return { status: 409, body: { error: { code, message: String(error.message) } } };
  if (error?.reason === 'retry_budget_exhausted') return { status: 409, body: { error: { code: 'RETRY_BUDGET_EXHAUSTED', message: 'retry budget exhausted', reason: error.reason } } };
  if (code === 'PUBLICATION_TRANSITION_ILLEGAL') return { status: 409, body: { error: { code, message: String(error.message) } } };
  const status = Number(error?.status ?? 400);
  if (status >= 500) return { status, body: { error: { code: 'PUBLICATION_INTERNAL', message: 'unexpected publication failure' } } };
  return { status, body: { error: { code, message: String(error?.message ?? 'publication request failed') } } };
}

export function createPublicationApi({ repo, localAuthService, rateLimiter } = {}) {
  if (!repo || typeof repo.create !== 'function' || typeof repo.transition !== 'function' || typeof repo.claimDue !== 'function' || typeof repo.getById !== 'function' || typeof repo.listByStatus !== 'function') throw new TypeError('publication jobs repo is required');
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rate limiter is required');
  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!(String(pathname ?? '').startsWith('/api/v1/publications'))) return null;
      try {
        const scopedTenant = tenantId(tenantHeader);
        const token = bearerToken(req.headers);
        const session = token ? await localAuthService.getSession({ tenantId: scopedTenant, token }) : null;
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };
        const actorId = String(session.user?.userId ?? '').trim();
        const role = String(session.user?.role ?? '').trim().toLowerCase();
        if (!actorId) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } } };
        const method = String(req.method ?? 'GET').toUpperCase();
        const ip = String(req?.socket?.remoteAddress ?? 'unknown');
        const throttled = await limited(rateLimiter, `publication:${method}:${scopedTenant}:${actorId}:${ip}`);
        if (throttled) return throttled;
        const url = new URL(req.url || pathname || '/', 'http://localhost');

        if (pathname === '/api/v1/publications' && method === 'POST') {
          if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'PUBLICATION_WRITE_FORBIDDEN', message: 'publication write requires owner or admin' } }, headers: { 'cache-control': 'no-store' } };
          const body = await readJson(req);
          const result = await repo.create(scopedTenant, { platform: body.platform, idempotencyKey: body.idempotencyKey, status: body.status, maxAttempts: body.maxAttempts, contentItemId: body.contentItemId, scheduledFor: body.scheduledFor });
          return { status: result.created ? 201 : 200, body: result.job ?? result, headers: { 'cache-control': 'no-store' } };
        }
        if (pathname === '/api/v1/publications' && method === 'GET') {
          const status = url.searchParams.get('status') || 'scheduled';
          const items = await repo.listByStatus(scopedTenant, status, url.searchParams.get('limit'));
          return { status: 200, body: { items }, headers: { 'cache-control': 'no-store' } };
        }
        if (pathname === '/api/v1/publications/claim' && method === 'POST') {
          if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'PUBLICATION_WRITE_FORBIDDEN', message: 'publication claim requires owner or admin' } }, headers: { 'cache-control': 'no-store' } };
          const body = await readJson(req);
          const now = body.now || new Date().toISOString();
          const limit = body.limit;
          const claimed = await repo.claimDue(scopedTenant, now, limit);
          return { status: 200, body: { claimed }, headers: { 'cache-control': 'no-store' } };
        }
        const match = /^\/api\/v1\/publications\/([0-9a-fA-F-]{36})(?:\/(transition))?$/.exec(String(pathname));
        if (!match) return { status: 404, body: { error: { code: 'PUBLICATION_ROUTE_NOT_FOUND', message: 'publication route not found' } } };
        const jobId = match[1].toLowerCase();
        const child = match[2] ?? null;
        if (!child && method === 'GET') {
          const job = await repo.getById(scopedTenant, jobId);
          if (!job) return { status: 404, body: { error: { code: 'PUBLICATION_NOT_FOUND', message: 'publication job not found' } } };
          return { status: 200, body: job, headers: { 'cache-control': 'no-store' } };
        }
        if (child === 'transition' && method === 'POST') {
          if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'PUBLICATION_WRITE_FORBIDDEN', message: 'publication transition requires owner or admin' } }, headers: { 'cache-control': 'no-store' } };
          const body = await readJson(req);
          const toStatus = body.toStatus || body.status;
          if (!toStatus) {
            const e = new Error('toStatus is required'); e.status = 400; e.code = 'TO_STATUS_REQUIRED'; throw e;
          }
          const result = await repo.transition(scopedTenant, jobId, toStatus, { externalContentId: body.externalContentId, failureCode: body.failureCode, failureReason: body.failureReason, nextRetryAt: body.nextRetryAt, scheduledFor: body.scheduledFor });
          if (!result.transitioned && result.reason === 'not_found') return { status: 404, body: { error: { code: 'PUBLICATION_NOT_FOUND', message: 'publication job not found' } } };
          if (!result.transitioned) return { status: 409, body: { error: { code: String(result.reason ?? 'TRANSITION_FAILED').toUpperCase(), message: String(result.reason ?? 'transition failed'), ...result } } };
          return { status: 200, body: result.job, headers: { 'cache-control': 'no-store' } };
        }
        return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
      } catch (error) {
        const result = safeFailure(error);
        return { ...result, headers: { 'cache-control': 'no-store', ...(result.headers ?? {}) } };
      }
    }
  });
}
