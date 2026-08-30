import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionOAuthApi } from '../apps/api/src/production-oauth-api.js';

const KEY = 'oidc-login-test-encryption-key-0123456789abcdef';
const NOW = 1_760_000_000_000;

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function request(url, { method = 'GET' } = {}) {
  return { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
}

function harness({ identity = { subject: 'signed-subject-42', email: 'signed@example.test', emailVerified: true }, verifyError = null, oidc = true } = {}) {
  const calls = { pending: [], consumed: [], completed: [], exchange: [], verified: [] };
  let storedPending = null;
  let consumed = false;
  const loginRepo = {
    async createPendingLogin(input) {
      calls.pending.push(input);
      storedPending = { ...input };
      return { id: 'login-pending-1', ...input };
    },
    async consumePendingLogin(input) {
      calls.consumed.push(input);
      if (consumed || !storedPending || input.provider !== storedPending.provider || input.stateHash !== storedPending.stateHash) return null;
      consumed = true;
      return { ...storedPending, consumedAt: new Date(NOW) };
    },
    async completeOidcLogin(input) {
      calls.completed.push(input);
      return {
        registered: true,
        user: {
          tenantId: input.newTenantId,
          userId: input.newUserId,
          email: input.email,
          emailVerified: input.emailVerified,
          role: 'owner',
          createdAt: new Date(NOW).toISOString()
        },
        session: { id: 'session-1', expiresAt: input.expiresAt }
      };
    }
  };
  const repo = {
    async createPendingAuthorization() { throw new Error('linking path must not be used'); },
    async consumePendingAuthorization() { return null; },
    async completeOAuthLink() { return { linked: true }; },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
  const localAuthService = { async getSession() { return null; } };
  const flow = {
    createAuthorization() {
      return {
        url: 'https://idp.example/authorize?state=unbound',
        state: 'random_state_1234567890abcdef',
        codeVerifier: 'pkce-verifier-secret-value-abcdefghijklmnopqrstuvwxyz0123456789',
        nonce: 'oidc-nonce-secret-abcdefghijklmnopqrstuvwxyz',
        expiresAt: NOW + 600_000
      };
    },
    async exchangeCode(input) {
      calls.exchange.push(input);
      return { accessToken: 'provider-access', idToken: 'signed.jwt.value', tokenType: 'Bearer', expiresAt: NOW + 3_600_000 };
    }
  };
  const entry = { issuer: 'https://idp.example/', flow };
  if (oidc) {
    entry.verifyIdentityClaims = async (input) => {
      calls.verified.push(input);
      if (verifyError) throw verifyError;
      return identity;
    };
    entry.verifyIdentity = async (input) => (await entry.verifyIdentityClaims(input)).subject;
  }
  const api = createProductionOAuthApi({
    registry: new Map([['acme', entry]]),
    repo,
    loginRepo,
    localAuthService,
    encryptionKey: KEY,
    rateLimiter: limiter(),
    clock: () => NOW
  });
  return { api, calls };
}

test('OIDC login starts without tenant or local session and encrypts PKCE plus nonce', async () => {
  const { api, calls } = harness();
  const result = await api.handle({ req: request('/api/v1/oauth/acme/login'), pathname: '/api/v1/oauth/acme/login' });
  assert.equal(result.status, 302);
  assert.equal(calls.pending.length, 1);
  assert.equal(calls.pending[0].provider, 'acme');
  assert.equal(calls.pending[0].authorizationCiphertext.includes('pkce-verifier-secret-value'), false);
  assert.equal(calls.pending[0].authorizationCiphertext.includes('oidc-nonce-secret'), false);
  const location = new URL(result.headers.location);
  assert.ok(location.searchParams.get('state').startsWith('login.'));
});

test('OIDC login callback uses only verified claims, issues a local session, and rejects replay', async () => {
  const { api, calls } = harness();
  const started = await api.handle({ req: request('/api/v1/oauth/acme/login'), pathname: '/api/v1/oauth/acme/login' });
  const state = new URL(started.headers.location).searchParams.get('state');
  const callbackUrl = `/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=grant-1`;
  const completed = await api.handle({ req: request(callbackUrl), pathname: '/api/v1/oauth/acme/callback' });

  assert.equal(completed.status, 200);
  assert.equal(completed.body.registered, true);
  assert.ok(completed.body.token.startsWith('zs_'));
  assert.equal(completed.body.user.email, 'signed@example.test');
  assert.equal(calls.exchange.length, 1);
  assert.equal(calls.exchange[0].authorization.codeVerifier.startsWith('pkce-verifier-secret-value'), true);
  assert.equal(calls.verified[0].nonce.startsWith('oidc-nonce-secret'), true);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].issuerSubject, 'signed-subject-42');
  assert.equal(calls.completed[0].email, 'signed@example.test');
  assert.equal(calls.completed[0].emailVerified, true);
  assert.match(calls.completed[0].tokenHash, /^[a-f0-9]{64}$/);

  const replay = await api.handle({ req: request(callbackUrl), pathname: '/api/v1/oauth/acme/callback' });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error.code, 'INVALID_OAUTH_STATE');
  assert.equal(calls.exchange.length, 1, 'replayed login state must not reach token exchange');
});

test('OIDC login uses a non-routable synthetic email when the signed token has no usable email', async () => {
  const { api, calls } = harness({ identity: { subject: 'subject-without-email', email: null, emailVerified: false } });
  const started = await api.handle({ req: request('/api/v1/oauth/acme/login'), pathname: '/api/v1/oauth/acme/login' });
  const state = new URL(started.headers.location).searchParams.get('state');
  const completed = await api.handle({
    req: request(`/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=grant-2`),
    pathname: '/api/v1/oauth/acme/callback'
  });
  assert.equal(completed.status, 200);
  assert.match(calls.completed[0].email, /^oidc-[a-f0-9]{24}@oidc\.invalid$/);
  assert.equal(calls.completed[0].emailVerified, false);
});

test('generic OAuth providers cannot enter standalone login and identity verification failures are redacted', async () => {
  const generic = harness({ oidc: false });
  const disabled = await generic.api.handle({ req: request('/api/v1/oauth/acme/login'), pathname: '/api/v1/oauth/acme/login' });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.error.code, 'OIDC_LOGIN_NOT_CONFIGURED');
  assert.equal(generic.calls.pending.length, 0);

  const failing = harness({ verifyError: new Error('provider leaked internal validation detail') });
  const started = await failing.api.handle({ req: request('/api/v1/oauth/acme/login'), pathname: '/api/v1/oauth/acme/login' });
  const state = new URL(started.headers.location).searchParams.get('state');
  const completed = await failing.api.handle({
    req: request(`/api/v1/oauth/acme/callback?state=${encodeURIComponent(state)}&code=grant-3`),
    pathname: '/api/v1/oauth/acme/callback'
  });
  assert.equal(completed.status, 401);
  assert.equal(completed.body.error.code, 'OIDC_ID_TOKEN_INVALID');
  assert.equal(JSON.stringify(completed.body).includes('provider leaked'), false);
  assert.equal(failing.calls.completed.length, 0);
});
