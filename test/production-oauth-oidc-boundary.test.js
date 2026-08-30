import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionOAuthApi } from '../apps/api/src/production-oauth-api.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'usr_oidc_owner';
const KEY = 'oidc-boundary-encryption-key-0123456789abcdef';
const NOW = 1_760_000_000_000;
const VERIFIER = 'pkce-verifier-secret-value-abcdefghijklmnopqrstuvwxyz0123456789';
const NONCE = 'oidc-nonce-secret-value-abcdefghijklmnopqrstuvwxyz';

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function request(url, { token = 'zs_session' } = {}) {
  return {
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function harness({ exchangeError = null } = {}) {
  const calls = { pending: [], completed: [], verify: [], exchange: [] };
  let pending = null;
  let consumed = false;
  const repo = {
    async createPendingAuthorization(input) {
      pending = { ...input };
      calls.pending.push(input);
      return input;
    },
    async consumePendingAuthorization(input) {
      if (consumed || !pending || pending.stateHash !== input.stateHash || pending.provider !== input.provider) return null;
      consumed = true;
      return { ...pending, consumedAt: new Date(NOW) };
    },
    async completeOAuthLink(input) {
      calls.completed.push(input);
      return { linked: true };
    },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
  const localAuthService = {
    async getSession({ tenantId, token }) {
      if (tenantId !== TENANT || token !== 'zs_session') return null;
      return { user: { tenantId: TENANT, userId: USER, role: 'owner' } };
    }
  };
  const flow = {
    createAuthorization() {
      return {
        provider: 'oidc',
        url: 'https://issuer.example/authorize?state=unbound',
        state: 'random_state_1234567890abcdef',
        codeVerifier: VERIFIER,
        nonce: NONCE,
        expiresAt: NOW + 600_000
      };
    },
    async exchangeCode(input) {
      calls.exchange.push(input);
      if (exchangeError) throw exchangeError;
      return {
        accessToken: 'provider-access-secret',
        refreshToken: 'provider-refresh-secret',
        idToken: 'header.payload.signature',
        tokenType: 'Bearer',
        scope: 'openid profile',
        expiresAt: NOW + 3_600_000,
        providerAccountId: 'unverified-provider-subject'
      };
    }
  };
  const entry = {
    issuer: 'https://issuer.example/',
    flow,
    async verifyIdentity({ tokens, nonce }) {
      calls.verify.push({ tokens, nonce });
      assert.equal(nonce, NONCE, 'OIDC verifier must receive the nonce restored from encrypted pending state');
      assert.equal(tokens.idToken, 'header.payload.signature');
      return 'signed-and-verified-subject';
    }
  };
  const api = createProductionOAuthApi({
    registry: new Map([['oidc', entry]]),
    repo,
    localAuthService,
    encryptionKey: KEY,
    rateLimiter: limiter(),
    clock: () => NOW
  });
  return { api, calls };
}

async function authorize(api) {
  return api.handle({
    req: request('/api/v1/oauth/oidc/authorize'),
    pathname: '/api/v1/oauth/oidc/authorize',
    tenantHeader: TENANT
  });
}

test('production OIDC encrypts verifier+nonce and persists only the verified identity subject', async () => {
  const { api, calls } = harness();
  const started = await authorize(api);
  assert.equal(started.status, 302);
  assert.equal(calls.pending.length, 1);
  const ciphertext = calls.pending[0].codeVerifierCiphertext;
  assert.equal(ciphertext.includes(VERIFIER), false);
  assert.equal(ciphertext.includes(NONCE), false);

  const state = new URL(started.headers.location).searchParams.get('state');
  const result = await api.handle({
    req: request(`/api/v1/oauth/oidc/callback?state=${encodeURIComponent(state)}&code=grant-1`, { token: '' }),
    pathname: '/api/v1/oauth/oidc/callback',
    tenantHeader: ''
  });

  assert.equal(result.status, 200);
  assert.equal(calls.exchange.length, 1);
  assert.equal(calls.exchange[0].authorization.codeVerifier, VERIFIER);
  assert.equal(calls.verify.length, 1);
  assert.equal(calls.completed.length, 1);
  assert.equal(calls.completed[0].issuerSubject, 'signed-and-verified-subject');
  assert.notEqual(calls.completed[0].issuerSubject, 'unverified-provider-subject');
  assert.equal(calls.completed[0].accessTokenCiphertext.includes('provider-access-secret'), false);
  assert.equal(calls.completed[0].refreshTokenCiphertext.includes('provider-refresh-secret'), false);
});

test('production callback redacts upstream OAuth exchange errors', async () => {
  const secretReason = 'invalid_grant: client_secret=do-not-reflect-this';
  const { api, calls } = harness({ exchangeError: new Error(secretReason) });
  const started = await authorize(api);
  const state = new URL(started.headers.location).searchParams.get('state');
  const result = await api.handle({
    req: request(`/api/v1/oauth/oidc/callback?state=${encodeURIComponent(state)}&code=bad-grant`, { token: '' }),
    pathname: '/api/v1/oauth/oidc/callback',
    tenantHeader: ''
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'OAUTH_EXCHANGE_FAILED');
  assert.equal(result.body.error.message, 'oauth provider token exchange failed');
  assert.equal(JSON.stringify(result).includes(secretReason), false);
  assert.equal(calls.verify.length, 0);
  assert.equal(calls.completed.length, 0);
});

test('production callback fails closed when signed identity verification fails', async () => {
  const { api, calls } = harness();
  const entry = api;
  void entry;
  const started = await authorize(api);
  const state = new URL(started.headers.location).searchParams.get('state');

  // Corrupt the verification result by replacing the harness callback method
  // through a fresh API with an explicit failing verifier while keeping the
  // same persistence/security contract.
  const failingCalls = { pending: null, completed: 0 };
  let consumed = false;
  const repo = {
    async createPendingAuthorization(input) { failingCalls.pending = { ...input }; return input; },
    async consumePendingAuthorization(input) {
      if (consumed || !failingCalls.pending || input.stateHash !== failingCalls.pending.stateHash) return null;
      consumed = true;
      return { ...failingCalls.pending, consumedAt: new Date(NOW) };
    },
    async completeOAuthLink() { failingCalls.completed += 1; return { linked: true }; },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
  const localAuthService = { async getSession() { return { user: { tenantId: TENANT, userId: USER, role: 'owner' } }; } };
  const flow = {
    createAuthorization() {
      return { url: 'https://issuer.example/authorize', state: 'other_state_1234567890abcdef', codeVerifier: VERIFIER, nonce: NONCE, expiresAt: NOW + 600_000 };
    },
    async exchangeCode() { return { accessToken: 'a', idToken: 'bad', expiresAt: NOW + 1000 }; }
  };
  const failingApi = createProductionOAuthApi({
    registry: new Map([['oidc', {
      issuer: 'https://issuer.example/',
      flow,
      async verifyIdentity() { const error = new Error('signature failure details'); error.code = 'OIDC_ID_TOKEN_INVALID'; throw error; }
    }]]),
    repo,
    localAuthService,
    encryptionKey: KEY,
    rateLimiter: limiter(),
    clock: () => NOW
  });
  const failingStart = await authorize(failingApi);
  const failingState = new URL(failingStart.headers.location).searchParams.get('state');
  const result = await failingApi.handle({
    req: request(`/api/v1/oauth/oidc/callback?state=${encodeURIComponent(failingState)}&code=g`, { token: '' }),
    pathname: '/api/v1/oauth/oidc/callback',
    tenantHeader: ''
  });
  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'OAUTH_IDENTITY_VERIFICATION_FAILED');
  assert.equal(JSON.stringify(result).includes('signature failure details'), false);
  assert.equal(failingCalls.completed, 0);

  // The original state remains unrelated to this fresh verifier and is not
  // accidentally consumed by another API instance.
  assert.ok(state.startsWith(`${TENANT}.`));
  assert.equal(calls.completed.length, 0);
});
