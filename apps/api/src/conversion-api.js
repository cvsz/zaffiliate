const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSION_ID_PATTERN = /^cnv_[A-Za-z0-9_-]{1,160}$/;
const MAX_BODY_BYTES = 16 * 1024;
const WRITE_ROLES = new Set(['owner', 'admin']);

function tenantId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) {
    const error = new Error('valid UUID x-tenant-id header is required');
    error.status = 400;
    error.code = 'TENANT_HEADER_INVALID';
    throw error;
  }
  return id;
}

function conversionId(value) {
  const id = String(value ?? '').trim();
  if (!CONVERSION_ID_PATTERN.test(id)) {
    const error = new Error('conversion id is invalid');
    error.status = 400;
    error.code = 'CONVERSION_ID_INVALID';
    throw error;
  }
  return id;
}

function bearerToken(headers = {}) {
  const match = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
  return match ? match[1].trim() : '';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request body too large');
      error.status = 413;
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('object required');
    return value;
  } catch {
    const error = new Error('request body must be a JSON object');
    error.status = 400;
    error.code = 'INVALID_JSON';
    throw error;
  }
}

async function limited(rateLimiter, key) {
  const verdict = await rateLimiter.tryAcquire(key);
  if (verdict.allowed) return null;
  return {
    status: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
    headers: { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1), 'cache-control': 'no-store' }
  };
}

function safeFailure(error) {
  const code = String(error?.code ?? 'CONVERSION_REQUEST_FAILED');
  if (code === 'CONVERSION_NOT_FOUND') return { status: 404, body: { error: { code, message: 'conversion not found' } } };
  const status = Number(error?.status ?? 400);
  if (status >= 500) return { status, body: { error: { code: 'CONVERSION_INTERNAL', message: 'unexpected conversion failure' } } };
  return { status, body: { error: { code, message: String(error?.message ?? 'conversion request failed') } } };
}

export function createConversionApi({ repo, localAuthService, rateLimiter } = {}) {
  if (!repo || typeof repo.getConversion !== 'function' || typeof repo.listConversions !== 'function' || typeof repo.aggregateCommission !== 'function' || typeof repo.updateConversionStatus !== 'function') {
    throw new TypeError('conversion reconciliation repo is required');
  }
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rate limiter is required');

  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!(pathname === '/api/v1/conversions' || String(pathname ?? '').startsWith('/api/v1/conversions/'))) return null;
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
        const throttled = await limited(rateLimiter, `conversion:${method}:${scopedTenant}:${actorId}:${ip}`);
        if (throttled) return throttled;
        const url = new URL(req.url || pathname || '/', 'http://localhost');
        const filters = {
          tenantId: scopedTenant,
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          status: url.searchParams.get('status')
        };

        if (pathname === '/api/v1/conversions' && method === 'GET') {
          const items = await repo.listConversions({ ...filters, limit: url.searchParams.get('limit') });
          return { status: 200, body: { items }, headers: { 'cache-control': 'no-store' } };
        }
        if (pathname === '/api/v1/conversions/commission-summary' && method === 'GET') {
          const items = await repo.aggregateCommission(filters);
          return { status: 200, body: { items }, headers: { 'cache-control': 'no-store' } };
        }

        const match = /^\/api\/v1\/conversions\/(cnv_[A-Za-z0-9_-]{1,160})(?:\/(status))?$/.exec(String(pathname));
        if (!match) return { status: 404, body: { error: { code: 'CONVERSION_ROUTE_NOT_FOUND', message: 'conversion route not found' } } };
        const id = conversionId(match[1]);
        const child = match[2] ?? null;

        if (!child && method === 'GET') {
          const item = await repo.getConversion({ tenantId: scopedTenant, conversionId: id });
          if (!item) return { status: 404, body: { error: { code: 'CONVERSION_NOT_FOUND', message: 'conversion not found' } } };
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        if (child === 'status' && method === 'PATCH') {
          if (!WRITE_ROLES.has(role)) {
            return { status: 403, body: { error: { code: 'CONVERSION_WRITE_FORBIDDEN', message: 'conversion reconciliation requires owner or admin role' } }, headers: { 'cache-control': 'no-store' } };
          }
          const body = await readJson(req);
          const item = await repo.updateConversionStatus({
            tenantId: scopedTenant,
            conversionId: id,
            status: body.status,
            actorId
          });
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
      } catch (error) {
        const result = safeFailure(error);
        return { ...result, headers: { 'cache-control': 'no-store', ...(result.headers ?? {}) } };
      }
    }
  });
}
