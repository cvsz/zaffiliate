import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProductionServer } from '../apps/api/src/production-server.js';

function allowedLimiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function fakeAuthService() {
  const calls = [];
  return {
    calls,
    async register(body) {
      calls.push(['register', body]);
      return { tenantId: 'tenant-1', userId: 'usr_1', email: body.email.toLowerCase(), role: 'owner', emailVerified: false };
    },
    async login(input) {
      calls.push(['login', input]);
      return { token: 'zs_test', expiresAt: new Date(Date.now() + 60_000).toISOString(), user: { tenantId: input.tenantId, userId: 'usr_1', email: input.email, role: 'owner' } };
    },
    async getSession() { return null; },
    async logout() { return { revoked: true }; },
    async requestPasswordReset() { return { accepted: true }; },
    async resetPassword() { return { reset: true, userId: 'usr_1' }; },
    async requestEmailVerification() { return { accepted: true }; },
    async confirmEmailVerification() { return { verified: true, userId: 'usr_1' }; }
  };
}

test('production server handles local auth before delegating existing API routes', async (t) => {
  const auth = fakeAuthService();
  const server = createProductionServer({
    env: { APP_ENV: 'development' },
    runtime: {},
    localAuthService: auth,
    rateLimiter: allowedLimiter()
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const registered = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orgName: 'Acme', email: 'Owner@Example.test', password: 'strong-password-123' })
  });
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).user.email, 'owner@example.test');
  assert.equal(auth.calls[0][0], 'register');
  assert.equal(registered.headers.get('cache-control'), 'no-store');

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
});

test('login requires tenant context and never permits caching the issued session token', async (t) => {
  const auth = fakeAuthService();
  const server = createProductionServer({ env: { APP_ENV: 'development' }, runtime: {}, localAuthService: auth, rateLimiter: allowedLimiter() });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const missingTenant = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.test', password: 'password123' })
  });
  assert.equal(missingTenant.status, 400);

  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-1' },
    body: JSON.stringify({ email: 'a@example.test', password: 'password123' })
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert.equal((await login.json()).token, 'zs_test');
});
