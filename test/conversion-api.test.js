import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createConversionApi } from '../apps/api/src/conversion-api.js';

const TENANT = '10000000-0000-4000-8000-000000000001';
const CONVERSION = 'cnv_test_001';

function request({ method = 'GET', url = '/', token = 'session-token', body } = {}) {
  const raw = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(raw);
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function fixture({ role = 'owner' } = {}) {
  const calls = [];
  const conversion = Object.freeze({ tenantId: TENANT, conversionId: CONVERSION, status: 'pending', currency: 'THB' });
  const repo = {
    async listConversions(input) { calls.push(['list', input]); return [conversion]; },
    async getConversion(input) { calls.push(['get', input]); return input.conversionId === CONVERSION ? conversion : null; },
    async aggregateCommission(input) { calls.push(['aggregate', input]); return [{ status: 'pending', currency: 'THB', count: 1, totalGrossCommissionMinorUnits: '1000' }]; },
    async updateConversionStatus(input) { calls.push(['status', input]); return { ...conversion, status: input.status }; }
  };
  const localAuthService = {
    async getSession({ tenantId, token }) {
      if (tenantId !== TENANT || token !== 'session-token') return null;
      return { user: { userId: 'usr_test', role } };
    }
  };
  const rateLimiter = { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
  return { api: createConversionApi({ repo, localAuthService, rateLimiter }), calls };
}

test('conversion API requires tenant-bound authentication', async () => {
  const { api } = fixture();
  const result = await api.handle({ req: request({ token: '' }), pathname: '/api/v1/conversions', tenantHeader: TENANT });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
});

test('conversion list forwards bounded query filters to repository', async () => {
  const { api, calls } = fixture();
  const url = '/api/v1/conversions?from=2026-08-01T00%3A00%3A00Z&to=2026-08-31T23%3A59%3A59Z&status=confirmed&limit=25';
  const result = await api.handle({ req: request({ url }), pathname: '/api/v1/conversions', tenantHeader: TENANT });
  assert.equal(result.status, 200);
  assert.equal(calls[0][0], 'list');
  assert.equal(calls[0][1].tenantId, TENANT);
  assert.equal(calls[0][1].status, 'confirmed');
  assert.equal(calls[0][1].limit, '25');
});

test('commission summary uses authenticated tenant and does not accept tenant from query', async () => {
  const { api, calls } = fixture();
  const url = '/api/v1/conversions/commission-summary?tenantId=ffffffff-ffff-4fff-8fff-ffffffffffff&status=pending';
  const result = await api.handle({ req: request({ url }), pathname: '/api/v1/conversions/commission-summary', tenantHeader: TENANT });
  assert.equal(result.status, 200);
  assert.equal(calls[0][0], 'aggregate');
  assert.equal(calls[0][1].tenantId, TENANT);
});

test('conversion status writes require owner/admin', async () => {
  const { api, calls } = fixture({ role: 'viewer' });
  const path = `/api/v1/conversions/${CONVERSION}/status`;
  const result = await api.handle({ req: request({ method: 'PATCH', url: path, body: { status: 'confirmed' } }), pathname: path, tenantHeader: TENANT });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'CONVERSION_WRITE_FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('conversion status update binds actor, tenant and URL id', async () => {
  const { api, calls } = fixture({ role: 'admin' });
  const path = `/api/v1/conversions/${CONVERSION}/status`;
  const result = await api.handle({
    req: request({ method: 'PATCH', url: path, body: { status: 'refunded', conversionId: 'cnv_spoofed' } }),
    pathname: path,
    tenantHeader: TENANT
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0], ['status', { tenantId: TENANT, conversionId: CONVERSION, status: 'refunded', actorId: 'usr_test' }]);
});
