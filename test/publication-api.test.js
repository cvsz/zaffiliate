import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPublicationApi } from '../apps/api/src/publication-api.js';

const TENANT = '00000000-0000-4000-8000-000000000021';
const JOB_ID = '00000000-0000-4000-8000-000000000099';

function request({ method = 'GET', url = '/', token = 'tok', body } = {}) {
  const raw = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(raw);
  req.method = method; req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
function fixture({ role = 'owner', repoOverrides = {} } = {}) {
  const repo = {
    async create(tenantId, input) { return { created: true, job: { tenantId, jobId: JOB_ID, platform: input.platform, status: input.status ?? 'draft', idempotencyKey: input.idempotencyKey } }; },
    async listByStatus(tenantId, status) { return [{ jobId: JOB_ID, status }]; },
    async claimDue(tenantId, nowIso, limit) { return [{ jobId: JOB_ID, attempt: 1 }]; },
    async getById(tenantId, jobId) { return jobId === JOB_ID ? { jobId, status: 'scheduled' } : null; },
    async transition(tenantId, jobId, toStatus) { return { transitioned: true, job: { jobId, status: toStatus } }; },
    ...repoOverrides
  };
  const localAuthService = { async getSession({ tenantId, token }) { if (tenantId !== TENANT || token !== 'tok') return null; return { user: { userId: 'usr_1', role } }; } };
  const rateLimiter = { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
  return { api: createPublicationApi({ repo, localAuthService, rateLimiter }) };
}

test('publication api requires authentication', async () => {
  const { api } = fixture();
  const r = await api.handle({ req: request({ token: '' }), pathname: '/api/v1/publications', tenantHeader: TENANT });
  assert.equal(r.status, 401);
});

test('publication create binds tenant and returns 201', async () => {
  const { api } = fixture();
  const r = await api.handle({ req: request({ method: 'POST', url: '/api/v1/publications', body: { platform: 'tiktok', idempotencyKey: 'k1' } }), pathname: '/api/v1/publications', tenantHeader: TENANT });
  assert.equal(r.status, 201);
  assert.equal(r.body.platform, 'tiktok');
});

test('publication claim requires owner/admin', async () => {
  const { api } = fixture({ role: 'viewer' });
  const r = await api.handle({ req: request({ method: 'POST', url: '/api/v1/publications/claim', body: { now: new Date().toISOString() } }), pathname: '/api/v1/publications/claim', tenantHeader: TENANT });
  assert.equal(r.status, 403);
});

test('publication transition binds url id', async () => {
  const { api } = fixture();
  const path = `/api/v1/publications/${JOB_ID}/transition`;
  const r = await api.handle({ req: request({ method: 'POST', url: path, body: { toStatus: 'processing' } }), pathname: path, tenantHeader: TENANT });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'processing');
});

test('publication get returns 404 for unknown job', async () => {
  const { api } = fixture();
  const path = '/api/v1/publications/00000000-0000-4000-8000-000000000000';
  const r = await api.handle({ req: request({ url: path }), pathname: path, tenantHeader: TENANT });
  assert.equal(r.status, 404);
});
