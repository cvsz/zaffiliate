import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProductionServer } from '../apps/api/src/production-server.js';

const KEY = 'oidc-login-wiring-encryption-key-0123456789abcdef';

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

test('production server exposes standalone OIDC login without tenant header', async (t) => {
  let pending = null;
  let consumed = false;
  const oauthLoginRepository = {
    async createPendingLogin(input) { pending = { ...input }; return { id: 'p1', ...input }; },
    async consumePendingLogin(input) {
      if (consumed || !pending || input.provider !== pending.provider || input.stateHash !== pending.stateHash) return null;
      consumed = true;
      return { ...pending };
    },
    async completeOidcLogin(input) {
      return {
        registered: true,
        user: {
          tenantId: input.newTenantId,
          userId: input.newUserId,
          email: input.email,
          emailVerified: input.emailVerified,
          role: 'owner',
          createdAt: new Date().toISOString()
        },
        session: { id: 'session-1', expiresAt: input.expiresAt }
      };
    }
  };
  const oauthRepository = {
    async createPendingAuthorization() { throw new Error('unused'); },
    async consumePendingAuthorization() { return null; },
    async completeOAuthLink() { return { linked: true }; },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
  const localAuthService = {
    async login() { throw new Error('unused'); },
    async getSession() { return null; }
  };
  const flow = {
    createAuthorization() {
      return {
        url: 'https://idp.example/authorize?state=old',
        state: 'state_1234567890abcdef',
        codeVerifier: 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        nonce: 'nonce-abcdefghijklmnopqrstuvwxyz-0123456789',
        expiresAt: Date.now() + 600_000
      };
    },
    async exchangeCode() {
      return { accessToken: 'access', idToken: 'signed.jwt.value', tokenType: 'Bearer' };
    }
  };
  const oauthRegistry = new Map([['acme', {
    issuer: 'https://idp.example',
    flow,
    async verifyIdentityClaims() {
      return { subject: 'verified-http-subject', email: 'http-oidc@example.test', emailVerified: true };
    },
    async verifyIdentity() { return 'verified-http-subject'; }
  }]]);

  const server = createProductionServer({
    env: { APP_ENV: 'development', ENCRYPTION_KEY: KEY },
    runtime: {},
    localAuthService,
    oauthRegistry,
    oauthRepository,
    oauthLoginRepository,
    rateLimiter: limiter()
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  const started = await fetch(`http://127.0.0.1:${port}/api/v1/oauth/acme/login`, { redirect: 'manual' });
  assert.equal(started.status, 302);
  const location = started.headers.get('location');
  assert.ok(location?.startsWith('https://idp.example/authorize'));
  const state = new URL(location).searchParams.get('state');
  assert.ok(state?.startsWith('login.'));

  const callback = await fetch(`http://127.0.0.1:${port}/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=grant-http`);
  assert.equal(callback.status, 200);
  const body = await callback.json();
  assert.ok(body.token.startsWith('zs_'));
  assert.equal(body.registered, true);
  assert.equal(body.user.email, 'http-oidc@example.test');
  assert.match(body.user.tenantId, /^[0-9a-f-]{36}$/);
});
