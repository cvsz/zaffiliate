const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 32 * 1024;
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

function campaignId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) {
    const error = new Error('campaign id must be a UUID');
    error.status = 400;
    error.code = 'CAMPAIGN_ID_INVALID';
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
  const code = String(error?.code ?? 'CAMPAIGN_REQUEST_FAILED');
  if (code === 'CAMPAIGN_NOT_FOUND') return { status: 404, body: { error: { code, message: 'campaign not found' } } };
  if (code === 'CAMPAIGN_TRANSITION_INVALID') return { status: 409, body: { error: { code, message: 'campaign lifecycle transition is not allowed' } } };
  if (code === 'CAMPAIGN_CONFLICT') return { status: 409, body: { error: { code, message: 'campaign conflicts with an existing campaign' } } };
  const status = Number(error?.status ?? 400);
  if (status >= 500) return { status, body: { error: { code: 'CAMPAIGN_INTERNAL', message: 'unexpected campaign failure' } } };
  return { status, body: { error: { code, message: String(error?.message ?? 'campaign request failed') } } };
}

export function createCampaignApi({ repo, affiliateRuntime, localAuthService, rateLimiter } = {}) {
  if (!repo || typeof repo.createCampaign !== 'function' || typeof repo.listCampaigns !== 'function') throw new TypeError('campaign repo is required');
  if (!affiliateRuntime || typeof affiliateRuntime.generateLink !== 'function') throw new TypeError('affiliate runtime with generateLink is required');
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rate limiter is required');

  async function authenticate(req, scopedTenant) {
    const token = bearerToken(req.headers);
    if (!token) return null;
    return localAuthService.getSession({ tenantId: scopedTenant, token });
  }

  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!(pathname === '/api/v1/campaigns' || String(pathname ?? '').startsWith('/api/v1/campaigns/'))) return null;
      try {
        const scopedTenant = tenantId(tenantHeader);
        const session = await authenticate(req, scopedTenant);
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };
        const actorId = String(session.user?.userId ?? '').trim();
        const role = String(session.user?.role ?? '').trim().toLowerCase();
        if (!actorId) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } } };
        const method = String(req.method ?? 'GET').toUpperCase();
        const ip = String(req?.socket?.remoteAddress ?? 'unknown');
        const url = new URL(req.url || pathname || '/', 'http://localhost');
        const match = /^\/api\/v1\/campaigns(?:\/([0-9a-fA-F-]{36})(?:\/(status|links))?)?$/.exec(String(pathname));
        if (!match) return { status: 404, body: { error: { code: 'CAMPAIGN_ROUTE_NOT_FOUND', message: 'campaign route not found' } } };
        const id = match[1] ? campaignId(match[1]) : null;
        const child = match[2] ?? null;
        const write = method !== 'GET';
        if (write && !WRITE_ROLES.has(role)) {
          return { status: 403, body: { error: { code: 'CAMPAIGN_WRITE_FORBIDDEN', message: 'campaign write requires owner or admin role' } }, headers: { 'cache-control': 'no-store' } };
        }
        const throttled = await limited(rateLimiter, `campaign:${method}:${scopedTenant}:${actorId}:${ip}`);
        if (throttled) return throttled;

        if (!id && !child && method === 'GET') {
          const items = await repo.listCampaigns({
            tenantId: scopedTenant,
            status: url.searchParams.get('status'),
            limit: url.searchParams.get('limit')
          });
          return { status: 200, body: { items }, headers: { 'cache-control': 'no-store' } };
        }
        if (!id && !child && method === 'POST') {
          const body = await readJson(req);
          const item = await repo.createCampaign({
            tenantId: scopedTenant,
            actorId,
            name: body.name,
            objective: body.objective,
            budgetLimit: body.budgetLimit
          });
          return { status: 201, body: item, headers: { 'cache-control': 'no-store' } };
        }
        if (id && !child && method === 'GET') {
          const item = await repo.getCampaign({ tenantId: scopedTenant, campaignId: id });
          if (!item) return { status: 404, body: { error: { code: 'CAMPAIGN_NOT_FOUND', message: 'campaign not found' } } };
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        if (id && !child && method === 'PATCH') {
          const body = await readJson(req);
          const item = await repo.updateCampaign({
            tenantId: scopedTenant,
            actorId,
            campaignId: id,
            ...(Object.hasOwn(body, 'name') ? { name: body.name } : {}),
            ...(Object.hasOwn(body, 'objective') ? { objective: body.objective } : {}),
            ...(Object.hasOwn(body, 'budgetLimit') ? { budgetLimit: body.budgetLimit } : {})
          });
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        if (id && child === 'status' && method === 'PATCH') {
          const body = await readJson(req);
          const item = await repo.transitionCampaign({ tenantId: scopedTenant, actorId, campaignId: id, to: body.status });
          return { status: 200, body: item, headers: { 'cache-control': 'no-store' } };
        }
        if (id && child === 'links' && method === 'POST') {
          const campaign = await repo.getCampaign({ tenantId: scopedTenant, campaignId: id });
          if (!campaign) return { status: 404, body: { error: { code: 'CAMPAIGN_NOT_FOUND', message: 'campaign not found' } } };
          if (campaign.status !== 'active') {
            return { status: 409, body: { error: { code: 'CAMPAIGN_NOT_ACTIVE', message: 'campaign must be active to generate links' } } };
          }
          const body = await readJson(req);
          const link = await affiliateRuntime.generateLink(scopedTenant, {
            offerId: body.offerId,
            destinationUrl: body.destinationUrl,
            subIds: body.subIds,
            slug: body.slug,
            expiresAt: body.expiresAt,
            campaignId: id
          });
          return { status: 201, body: link, headers: { 'cache-control': 'no-store' } };
        }
        return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
      } catch (error) {
        const result = safeFailure(error);
        return { ...result, headers: { 'cache-control': 'no-store', ...(result.headers ?? {}) } };
      }
    }
  });
}
