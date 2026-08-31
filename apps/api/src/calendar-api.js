const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

function tenantId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) { const e = new Error('valid UUID x-tenant-id header is required'); e.status = 400; e.code = 'TENANT_HEADER_INVALID'; throw e; }
  return id;
}
function bearerToken(headers = {}) {
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
  return m ? m[1].trim() : '';
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > MAX_BODY_BYTES) { const e = new Error('request body too large'); e.status = 413; e.code = 'BODY_TOO_LARGE'; throw e; } chunks.push(b); }
  if (size === 0) return {};
  try { const v = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); if (!v || Array.isArray(v) || typeof v !== 'object') throw new Error('object required'); return v; } catch { const e = new Error('request body must be a JSON object'); e.status = 400; e.code = 'INVALID_JSON'; throw e; }
}

export function createCalendarApi({ repo, localAuthService, rateLimiter } = {}) {
  if (!repo || typeof repo.create !== 'function' || typeof repo.list !== 'function') throw new TypeError('calendar repo is required');
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rate limiter is required');
  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!String(pathname ?? '').startsWith('/api/v1/calendar')) return null;
      try {
        const scopedTenant = tenantId(tenantHeader);
        const token = bearerToken(req.headers);
        const session = token ? await localAuthService.getSession({ tenantId: scopedTenant, token }) : null;
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };
        const method = String(req.method ?? 'GET').toUpperCase();
        const verdict = await rateLimiter.tryAcquire(`calendar:${method}:${scopedTenant}:${session.user.userId}:${req.socket?.remoteAddress ?? 'unknown'}`);
        if (!verdict.allowed) return { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } }, headers: { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1), 'cache-control': 'no-store' } };
        const url = new URL(req.url || pathname || '/', 'http://localhost');
        if (pathname === '/api/v1/calendar/events' && method === 'POST') {
          const body = await readJson(req);
          const created = await repo.create({ tenantId: scopedTenant, title: body.title, kind: body.kind, startsAt: body.startsAt, endsAt: body.endsAt, payload: body.payload });
          return { status: 201, body: created, headers: { 'cache-control': 'no-store' } };
        }
        if (pathname === '/api/v1/calendar/events' && method === 'GET') {
          const items = await repo.list({ tenantId: scopedTenant, from: url.searchParams.get('from'), to: url.searchParams.get('to'), limit: url.searchParams.get('limit') });
          return { status: 200, body: { items }, headers: { 'cache-control': 'no-store' } };
        }
        const match = /^\/api\/v1\/calendar\/events\/([0-9a-fA-F-]{36})$/.exec(String(pathname));
        if (match && method === 'GET') {
          const item = await repo.get({ tenantId: scopedTenant, id: match[1].toLowerCase() });
          if (!item) return { status: 404, body: { error: { code: 'CALENDAR_NOT_FOUND', message: 'calendar event not found' } } };
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        return { status: 404, body: { error: { code: 'CALENDAR_ROUTE_NOT_FOUND', message: 'calendar route not found' } } };
      } catch (error) {
        const status = Number(error?.status ?? 400);
        const code = String(error?.code ?? 'CALENDAR_REQUEST_FAILED');
        if (status >= 500) return { status, body: { error: { code: 'CALENDAR_INTERNAL', message: 'unexpected calendar failure' } }, headers: { 'cache-control': 'no-store' } };
        return { status, body: { error: { code, message: String(error?.message ?? 'calendar request failed') } }, headers: { 'cache-control': 'no-store' } };
      }
    }
  });
}
