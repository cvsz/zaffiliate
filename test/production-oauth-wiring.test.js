import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProductionServer } from '../apps/api/src/production-server.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const KEY = 'oauth-wiring-encryption-key-0123456789abcdef';

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

test('production server routes oauth through authenticated persistent boundary before legacy server', async (t) => {
  const pending = [];
  const authService = {
    async login() { throw new Error('unused'); },
    async getSession({ tenantId, token }) {
      if (tenantId === TENANT && token === 'zs_live') return { user: { tenantId, userId: 'usr_live', email: 'live@example.test', role: 'owner' } };
      return null;
    }
  };
  const oauthRepository = {
    async createPendingAuthorization(input) { pending.push(input); return { id: 'pending', ...input }; },
    async consumePendingAuthorization() { return null; },
    async completeOAuthLink() { return { linked: true }; },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
  const flow = {
    createAuthorization() {
      return {
        url: 'https://idp.example/authorize?state=old',
        state: 'state_1234567890abcdef',
        codeVerifier: 'verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        expiresAt: Date.now() + 600_000
      };
    },
    async exchangeCode() { throw new Error('unused'); }
  };
  const server = createProductionServer({
    env: { APP_ENV: 'development', ENCRYPTION_KEY: KEY },
    runtime: {},
    localAuthService: authService,
    oauthRegistry: new Map([['acme', { issuer: 'https://idp.example', flow }]]),
    oauthRepository,
    rateLimiter: limiter()
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/oauth/acme/authorize?userId=usr_attacker`, {
    redirect: 'manual',
    headers: {
      authorization: 'Bearer zs_live',
      'x-tenant-id': TENANT
    }
  });
  assert.equal(response.status, 302);
  assert.ok(response.headers.get('location').startsWith('https://idp.example/authorize'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].userId, 'usr_live');
  assert.equal(pending[0].tenantId, TENANT);
});
