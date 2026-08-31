import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCalendarApi } from '../apps/api/src/calendar-api.js';

const TENANT = '00000000-0000-4000-8000-000000000031';

function request({ method = 'GET', url = '/', token = 'tok', body } = {}) {
  const raw = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(raw);
  req.method = method; req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function fixture({ role = 'owner' } = {}) {
  let seq = 0;
  const store = new Map();
  const repo = {
    async create({ tenantId, title, kind, startsAt, endsAt }) {
      const allowed = new Set(['campaign','content','publish','meeting']);
      if (!allowed.has(String(kind ?? '').toLowerCase())) { const e = new Error(`unsupported calendar kind: ${kind}`); e.status = 400; throw e; }
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      const row = { id, tenantId, title, kind: String(kind).toLowerCase(), startsAt: new Date(startsAt).toISOString(), endsAt: endsAt ? new Date(endsAt).toISOString() : null };
      store.set(`${tenantId}:${id}`, row);
      return row;
    },
    async list({ tenantId }) {
      return [...store.values()].filter((r) => r.tenantId === tenantId);
    },
    async get({ tenantId, id }) {
      return store.get(`${tenantId}:${id}`) ?? null;
    }
  };
  const localAuthService = { async getSession({ tenantId, token }) { if (tenantId !== TENANT || token !== 'tok') return null; return { user: { userId: 'usr_1', role } }; } };
  const rateLimiter = { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
  return { api: createCalendarApi({ repo, localAuthService, rateLimiter }), store };
}

test('calendar api requires authentication', async () => {
  const { api } = fixture();
  const r = await api.handle({ req: request({ token: '' }), pathname: '/api/v1/calendar/events', tenantHeader: TENANT });
  assert.equal(r.status, 401);
});

test('calendar create and list returns items', async () => {
  const { api } = fixture();
  const create = await api.handle({ req: request({ method: 'POST', url: '/api/v1/calendar/events', body: { title: 'Launch Q4', kind: 'campaign', startsAt: new Date().toISOString() } }), pathname: '/api/v1/calendar/events', tenantHeader: TENANT });
  assert.equal(create.status, 201);
  assert.equal(create.body.title, 'Launch Q4');
  const list = await api.handle({ req: request({ method: 'GET', url: '/api/v1/calendar/events' }), pathname: '/api/v1/calendar/events', tenantHeader: TENANT });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
});

test('calendar get binds tenant isolation', async () => {
  const { api } = fixture();
  const created = await api.handle({ req: request({ method: 'POST', url: '/api/v1/calendar/events', body: { title: 'Sync', kind: 'meeting', startsAt: new Date().toISOString() } }), pathname: '/api/v1/calendar/events', tenantHeader: TENANT });
  const id = created.body.id;
  const ok = await api.handle({ req: request({ url: `/api/v1/calendar/events/${id}` }), pathname: `/api/v1/calendar/events/${id}`, tenantHeader: TENANT });
  assert.equal(ok.status, 200);
  const cross = await api.handle({ req: request({ url: `/api/v1/calendar/events/${id}` }), pathname: `/api/v1/calendar/events/${id}`, tenantHeader: '00000000-0000-4000-8000-000000000099' });
  assert.equal(cross.status, 401);
});

test('calendar kind validation fail-closed 400', async () => {
  const { api } = fixture();
  const r = await api.handle({ req: request({ method: 'POST', url: '/api/v1/calendar/events', body: { title: 'Bad', kind: 'unknown', startsAt: new Date().toISOString() } }), pathname: '/api/v1/calendar/events', tenantHeader: TENANT });
  assert.equal(r.status, 400);
});
