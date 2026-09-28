const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_COOKIE = '__Host-zaff_session';
const TENANT_COOKIE = '__Host-zaff_tenant';

function parseCookies(header = '') {
  const out = {};
  for (const item of String(header).split(';')) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = item.slice(0, idx).trim();
    try { out[key] = decodeURIComponent(item.slice(idx + 1).trim()); } catch { void 0; }
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function jsonBody(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

export function createSessionBridge({ authOrigin, timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const origin = String(authOrigin ?? '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(origin)) throw new Error('CONTROL_PLANE_AUTH_ORIGIN must be http(s)');
  async function call(path, { method = 'GET', tenantId, token, body } = {}) {
    const response = await fetchImpl(origin + path, {
      method,
      headers: {
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { response, payload };
  }
  async function login(req) {
    const body = await jsonBody(req);
    const tenantId = String(body.tenantId ?? '').trim().toLowerCase();
    if (!TENANT_UUID.test(tenantId)) return { status: 400, body: { error: 'tenant_id_invalid' } };
    const { response, payload } = await call('/api/v1/auth/login', {
      method: 'POST', tenantId, body: { email: body.email, password: body.password }
    });
    if (!response.ok || !payload?.token || !payload?.user) {
      return { status: response.status === 429 ? 429 : 401, body: { error: 'invalid_credentials' } };
    }
    if (String(payload.user.tenantId).toLowerCase() !== tenantId) return { status: 401, body: { error: 'tenant_mismatch' } };
    const ttl = Math.max(60, Math.floor((new Date(payload.expiresAt).getTime() - Date.now()) / 1000));
    return {
      status: 200,
      headers: { 'set-cookie': [cookie(SESSION_COOKIE, payload.token, ttl), cookie(TENANT_COOKIE, tenantId, ttl)] },
      body: { user: payload.user, expiresAt: payload.expiresAt }
    };
  }
  async function resolve(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    const tenantId = String(cookies[TENANT_COOKIE] ?? '').toLowerCase();
    if (!token || !TENANT_UUID.test(tenantId)) return null;
    const requested = String(req.headers['x-tenant-id'] ?? '').trim().toLowerCase();
    if (requested && requested !== tenantId) return null;
    const { response, payload } = await call('/api/v1/auth/me', { tenantId, token });
    if (!response.ok || !payload?.user || String(payload.user.tenantId).toLowerCase() !== tenantId) return null;
    return { tenantId, token, session: payload };
  }
  async function logout(req) {
    const current = await resolve(req).catch(() => null);
    if (current) await call('/api/v1/auth/logout', { method: 'POST', tenantId: current.tenantId, token: current.token }).catch(() => null);
    return {
      status: 200,
      headers: { 'set-cookie': [cookie(SESSION_COOKIE, '', 0), cookie(TENANT_COOKIE, '', 0)] },
      body: { ok: true }
    };
  }
  return Object.freeze({ login, resolve, logout });
}
