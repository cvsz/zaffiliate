import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionOAuthApi } from '../apps/api/src/production-oauth-api.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'usr_authenticated';
const KEY = 'oauth-test-encryption-key-0123456789abcdef';
const NOW = 1_760_000_000_000;

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function request(url, { method = 'GET', token = 'zs_session' } = {}) {
  return {
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function harness({ providerAccountId = 'remote-account-42' } = {}) {
  const calls = { pending: [], consumed: [], completed: [], disconnected: [], exchange: [] };
  let storedPending = null;
  let consumed = false;
  const repo = {
    async createPendingAuthorization(input) {
      calls.pending.push(input);
      storedPending = { ...input, expiresAt: input.expiresAt };
      return { id: 'pending-1', ...input };
    },
    async consumePendingAuthorization(input) {
      calls.consumed.push(input);
      if (consumed || !storedPending || input.stateHash !== storedPending.stateHash || input.provider !== storedPending.provider) return null;
      consumed = true;
      return { ...storedPending, consumedAt: new Date(NOW) };
    },
    async completeOAuthLink(input) {
      calls.completed.push(input);
      return { linked: true, identityId: 'identity-1', userId: input.userId };
    },
    async disconnectProvider(input) {
      calls.disconnected.push(input);
      return { removedIdentities: 1, removedTokenSets: 1 };
    }
  };
  const localAuthService = {
    async getSession({ tenantId, token }) {
      if (tenantId !== TENANT || token !== 'zs_session') return null;
      return { user: { tenantId: TENANT, userId: USER, email: 'owner@example.test', role: 'owner' } };
    }
  };
  const flow = {
    provider: 'acme',
    createAuthorization() {
      return {
        provider: 'acme',
        url: 'https://idp.example/authorize?state=unbound',
        state: 'random_state_1234567890abcdef',
        codeVerifier: 'pkce-verifier-secret-value-abcdefghijklmnopqrstuvwxyz0123456789',
        expiresAt: NOW + 600_000
      };
    },
    async exchangeCode(input) {
      calls.exchange.push(input);
      return {
        accessToken: 'access-token-secret',
        refreshToken: 'refresh-token-secret',
        tokenType: 'Bearer',
        scope: 'read write',
        expiresAt: NOW + 3_600_000,
        providerAccountId
      };
    }
  };
  const registry = new Map([['acme', { issuer: 'https://idp.example', flow }]]);
  const api = createProductionOAuthApi({ registry, repo, localAuthService, encryptionKey: KEY, rateLimiter: limiter(), clock: () => NOW });
  return { api, calls };
}

test('authorize binds pending state to authenticated durable session instead of client userId', async () => {
  const { api, calls } = harness();
  const result = await api.handle({
    req: request('/api/v1/oauth/acme/authorize?userId=usr_attacker'),
    pathname: '/api/v1/oauth/acme/authorize',
    tenantHeader: TENANT
  });
  assert.equal(result.status, 302);
  assert.equal(calls.pending.length, 1);
  assert.equal(calls.pending[0].tenantId, TENANT);
  assert.equal(calls.pending[0].userId, USER);
  assert.equal(calls.pending[0].codeVerifierCiphertext.includes('pkce-verifier-secret-value'), false);
  const location = new URL(result.headers.location);
  assert.ok(location.searchParams.get('state').startsWith(`${TENANT}.`));
  assert.equal(location.searchParams.get('userId'), null);
});

test('callback consumes state once, decrypts verifier, and stores only encrypted provider tokens', async () => {
  const { api, calls } = harness();
  const started = await api.handle({
    req: request('/api/v1/oauth/acme/authorize'),
    pathname: '/api/v1/oauth/acme/authorize',
    tenantHeader: TENANT
  });
  const state = new URL(started.headers.location).searchParams.get('state');
  const callbackUrl = `/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=grant-77`;
  const completed = await api.handle({ req: request(callbackUrl, { token: '' }), pathname: '/api/v1/oauth/acme/callback', tenantHeader: '' });
  assert.equal(completed.status, 200);
  assert.equal(calls.exchange.length, 1);
  assert.equal(calls.exchange[0].authorization.codeVerifier.startsWith('pkce-verifier-secret-value'), true);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].tenantId, TENANT);
  assert.equal(calls.completed[0].userId, USER);
  assert.equal(calls.completed[0].issuerSubject, 'remote-account-42');
  assert.equal(calls.completed[0].accessTokenCiphertext.includes('access-token-secret'), false);
  assert.equal(calls.completed[0].refreshTokenCiphertext.includes('refresh-token-secret'), false);

  const replay = await api.handle({ req: request(callbackUrl, { token: '' }), pathname: '/api/v1/oauth/acme/callback', tenantHeader: '' });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error.code, 'INVALID_OAUTH_STATE');
  assert.equal(calls.exchange.length, 1, 'replay must not reach the token endpoint');
});

test('production oauth fails closed without authenticated session or provider account subject', async () => {
  const unauth = harness();
  const denied = await unauth.api.handle({
    req: request('/api/v1/oauth/acme/authorize', { token: '' }),
    pathname: '/api/v1/oauth/acme/authorize',
    tenantHeader: TENANT
  });
  assert.equal(denied.status, 401);
  assert.equal(unauth.calls.pending.length, 0);

  const missingSubject = harness({ providerAccountId: null });
  const started = await missingSubject.api.handle({
    req: request('/api/v1/oauth/acme/authorize'),
    pathname: '/api/v1/oauth/acme/authorize',
    tenantHeader: TENANT
  });
  const state = new URL(started.headers.location).searchParams.get('state');
  const callback = await missingSubject.api.handle({
    req: request(`/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=g`, { token: '' }),
    pathname: '/api/v1/oauth/acme/callback',
    tenantHeader: ''
  });
  assert.equal(callback.status, 502);
  assert.equal(callback.body.error.code, 'OAUTH_SUBJECT_MISSING');
  assert.equal(missingSubject.calls.completed.length, 0);
});

test('disconnect derives user identity from bearer session and deletes durable oauth data', async () => {
  const { api, calls } = harness();
  const result = await api.handle({
    req: request('/api/v1/oauth/acme/disconnect', { method: 'POST' }),
    pathname: '/api/v1/oauth/acme/disconnect',
    tenantHeader: TENANT
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.disconnected[0], {
    tenantId: TENANT,
    userId: USER,
    provider: 'acme',
    issuer: 'https://idp.example'
  });
  assert.deepEqual(result.body.dataDeleted, ['stored_tokens', 'account_link']);
});
