import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionBridge } from '../apps/web/session-bridge.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function request({ body = null, cookie = '' } = {}) {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    headers: { cookie },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }
  };
}

test('session bridge exchanges credentials without returning bearer token to browser body', async () => {
  const calls = [];
  const bridge = createSessionBridge({
    authOrigin: 'http://api:8080',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        token: 'zs_server_only_token',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        user: { tenantId: TENANT, userId: 'user-1', role: 'owner', email: 'owner@example.test' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await bridge.login(request({ body: { tenantId: TENANT, email: 'owner@example.test', password: 'correct-horse-battery-staple' } }));
  assert.equal(result.status, 200);
  assert.equal(Object.hasOwn(result.body, 'token'), false);
  assert.equal(result.body.user.tenantId, TENANT);
  assert.equal(result.headers['set-cookie'].length, 2);
  assert.match(result.headers['set-cookie'][0], /HttpOnly/);
  assert.match(result.headers['set-cookie'][0], /Secure/);
  assert.match(result.headers['set-cookie'][0], /SameSite=Strict/);
  assert.equal(calls[0].url, 'http://api:8080/api/v1/auth/login');
});

test('session bridge resolves tenant only from matching HttpOnly cookie state', async () => {
  const bridge = createSessionBridge({
    authOrigin: 'http://api:8080',
    fetchImpl: async () => new Response(JSON.stringify({
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      user: { tenantId: TENANT, userId: 'user-1', role: 'admin' }
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  const req = request({ cookie: `__Host-zaff_session=zs_cookie_token; __Host-zaff_tenant=${TENANT}` });
  req.headers['x-tenant-id'] = TENANT;
  const session = await bridge.resolve(req);
  assert.equal(session.tenantId, TENANT);
  assert.equal(session.session.user.role, 'admin');

  const forged = request({ cookie: `__Host-zaff_session=zs_cookie_token; __Host-zaff_tenant=${TENANT}` });
  forged.headers['x-tenant-id'] = '22222222-2222-4222-8222-222222222222';
  assert.equal(await bridge.resolve(forged), null);
});

test('logout revokes backend session and expires both browser cookies', async () => {
  const calls = [];
  const bridge = createSessionBridge({
    authOrigin: 'http://api:8080',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/me')) {
        return new Response(JSON.stringify({ user: { tenantId: TENANT, userId: 'user-1', role: 'owner' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const req = request({ cookie: `__Host-zaff_session=zs_cookie_token; __Host-zaff_tenant=${TENANT}` });
  const result = await bridge.logout(req);
  assert.equal(result.status, 200);
  assert.ok(calls.some((x) => x.url.endsWith('/logout')));
  assert.ok(result.headers['set-cookie'].every((value) => value.includes('Max-Age=0')));
});
