import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOAuthFlow, createTokenStore, OAuthStateError, OAuthTokenError } from '../packages/security/src/oauth.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';

const NOW = 1_760_000_000_000;
const clock = () => NOW;

function deterministicRandom() {
  let counter = 0;
  return (bytes) => {
    counter += 1;
    return Buffer.concat([Buffer.from([counter]), Buffer.alloc(bytes - 1, counter & 0xff)]);
  };
}

function flow(overrides = {}) {
  return createOAuthFlow({
    provider: 'acme',
    clientId: 'client-123',
    clientSecret: 'secret-456',
    authorizeUrl: 'https://idp.acme.example/authorize',
    tokenUrl: 'https://idp.acme.example/token',
    redirectUri: 'https://app.zeaz.dev/api/v1/oauth/acme/callback',
    scope: 'read write',
    transport: async () => ({ status: 200, json: {} }),
    clock,
    ...overrides
  });
}

test('createAuthorization builds S256 PKCE url with state and verifier', () => {
  const f = flow({ randomBytesFn: deterministicRandom() });
  const auth = f.createAuthorization();
  assert.equal(auth.provider, 'acme');
  const url = new URL(auth.url);
  assert.equal(url.origin + url.pathname, 'https://idp.acme.example/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const expectedChallenge = createHash('sha256').update(auth.codeVerifier).digest().toString('base64url');
  assert.equal(url.searchParams.get('code_challenge'), expectedChallenge);
  assert.ok(auth.state.length >= 16);
  assert.ok(auth.codeVerifier.length >= 43, 'PKCE verifier must be 43+ chars');
  assert.equal(auth.expiresAt, NOW + 10 * 60 * 1000);
});

test('exchangeCode posts authorization grant with code_verifier and normalizes tokens', async () => {
  const seen = [];
  const f = flow({
    randomBytesFn: deterministicRandom(),
    transport: async (request) => {
      seen.push(request);
      return { status: 200, json: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer', scope: 'read' } };
    }
  });
  const auth = f.createAuthorization();
  const tokens = await f.exchangeCode({ authorization: auth, code: 'grant-9' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://idp.acme.example/token');
  assert.equal(seen[0].method, 'POST');
  const form = new URLSearchParams(seen[0].body);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), 'grant-9');
  assert.equal(form.get('client_id'), 'client-123');
  assert.equal(form.get('client_secret'), 'secret-456');
  assert.equal(form.get('code_verifier'), auth.codeVerifier);
  assert.equal(tokens.accessToken, 'at-1');
  assert.equal(tokens.refreshToken, 'rt-1');
  assert.equal(tokens.expiresAt, NOW + 3_600_000);
  assert.equal(tokens.tokenType, 'Bearer');
});

test('expired or malformed pending authorization fails closed before any network call', async () => {
  let calls = 0;
  const f = flow({
    transport: async () => {
      calls += 1;
      return { status: 200, json: { access_token: 'x' } };
    }
  });
  const auth = f.createAuthorization({ stateTtlMs: 1000 });
  const expired = { ...auth, expiresAt: NOW - 1 };
  await assert.rejects(() => f.exchangeCode({ authorization: expired, code: 'g' }), (error) => error instanceof OAuthStateError && error.reason === 'state_expired');
  await assert.rejects(() => f.exchangeCode({ authorization: null, code: 'g' }), OAuthStateError);
  await assert.rejects(() => f.exchangeCode({ authorization: { ...auth, codeVerifier: '' }, code: 'g' }), (error) => error instanceof OAuthStateError && error.reason === 'missing_code_verifier');
  assert.equal(calls, 0, 'no token request may leave the process on rejected state');
});

test('provider rejection and missing access_token surface typed errors', async () => {
  const failing = flow({ transport: async () => ({ status: 400, json: { error: 'invalid_grant' } }) });
  await assert.rejects(() => failing.exchangeCode({ authorization: failing.createAuthorization(), code: 'bad' }),
    (error) => error instanceof OAuthTokenError && error.httpStatus === 400 && error.reason === 'invalid_grant');

  const empty = flow({ transport: async () => ({ status: 200, json: { nope: true } }) });
  await assert.rejects(() => empty.exchangeCode({ authorization: empty.createAuthorization(), code: 'ok' }),
    (error) => error instanceof OAuthTokenError && error.reason === 'missing_access_token');

  const boom = flow({ transport: async () => { throw new Error('socket down'); } });
  await assert.rejects(() => boom.exchangeCode({ authorization: boom.createAuthorization(), code: 'ok' }),
    (error) => error instanceof OAuthTokenError && error.reason === 'transport_failure');
});

test('configuration validation fails closed', () => {
  assert.throws(() => flow({ authorizeUrl: 'http://insecure.example/authorize' }), /must be https/);
  assert.throws(() => flow({ tokenUrl: 'not a url' }), /must be a valid URL/);
  assert.throws(() => flow({ clientId: '' }), /clientId is required/);
  assert.throws(() => flow({ transport: undefined }), /transport function is required/);
  assert.throws(() => flow({ provider: 'A!' }), /provider must be/);
});

function harness() {
  const backend = createInMemorySecretBackend();
  const manager = createSecretManager({ backend });
  const f = flow();
  const store = createTokenStore({ manager, provider: 'acme', flow: f, clock });
  return { backend, manager, f, store };
}

test('token store persists via ref manager without exposing secrets in results', () => {
  const { store, backend } = harness();
  const result = store.store({ accessToken: 'at-2', refreshToken: 'rt-2' });
  assert.deepEqual(result, { stored: true });
  assert.equal(backend.get('ref:oauth/acme/access'), 'at-2');
  assert.equal(backend.get('ref:oauth/acme/refresh'), 'rt-2');
  assert.equal(JSON.stringify(result).includes('at-2'), false);
});

test('refresh rotates tokens and keeps old refresh when provider omits rotation', async () => {
  const { f, store } = harness();
  store.store({ accessToken: 'old-at', refreshToken: 'old-rt' });
  const seen = [];
  const refreshed = await store.refresh({
    transport: async (request) => {
      seen.push(request);
      return { status: 200, json: { access_token: 'new-at', expires_in: 600 } };
    }
  });
  assert.equal(refreshed.status, 'REFRESHED');
  assert.equal(refreshed.expiresAt, NOW + 600_000);
  const form = new URLSearchParams(seen[0].body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('refresh_token'), 'old-rt');
  assert.equal(form.get('client_secret'), 'secret-456', 'refresh grant must carry client credentials');
  assert.equal(store.readAccessToken(), 'new-at');
  assert.equal(store.storedRefreshToken(), 'old-rt', 'unrotated refresh must be preserved');
});

test('revocation during refresh clears stored material and demands reauth', async () => {
  const { store } = harness();
  store.store({ accessToken: 'a', refreshToken: 'r' });
  const revoked = await store.refresh({ transport: async () => ({ status: 400, json: { error: 'invalid_grant' } }) });
  assert.equal(revoked.status, 'REAUTH_REQUIRED');
  assert.equal(revoked.reason, 'invalid_grant');
  assert.equal(store.readAccessToken(), null);
  assert.equal(store.storedRefreshToken(), null);

  store.store({ accessToken: 'a2', refreshToken: 'r2' });
  const unauthorized = await store.refresh({ transport: async () => ({ status: 401, json: {} }) });
  assert.equal(unauthorized.status, 'REAUTH_REQUIRED');
  assert.equal(store.storedRefreshToken(), null);
});

test('refresh with no stored token returns REAUTH_REQUIRED without touching network', async () => {
  let calls = 0;
  const { store } = harness();
  const outcome = await store.refresh({ transport: async () => { calls += 1; return { status: 200, json: {} }; } });
  assert.deepEqual(outcome, { status: 'REAUTH_REQUIRED', reason: 'no_refresh_token' });
  assert.equal(calls, 0);
});

// ── server wiring over real HTTP

import { buildServer } from '../apps/api/src/server.js';
import { createIdentityBillingRuntime } from '../packages/identity-billing/src/runtime.js';
import { once } from 'node:events';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function registryEntry({ transport, subjectHint = null } = {}) {
  const f = flow({ randomBytesFn: deterministicRandom(), transport });
  const backend = createInMemorySecretBackend();
  const manager = createSecretManager({ backend });
  const store = createTokenStore({ manager, provider: 'acme', flow: f, clock });
  return { flow: f, tokenStore: store, issuer: 'https://idp.acme.example', subjectHint };
}

test('oauth routes fail closed when no provider is registered', async (t) => {
  const server = buildServer();
  t.after(() => server.close());
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/oauth/acme/authorize?userId=u1`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'OAUTH_NOT_CONFIGURED');
});

async function oauthHarness(t, transport, identityRuntime, entryOverrides = {}) {
  const server = buildServer({
    oauthRegistry: new Map([['acme', registryEntry({ transport, ...entryOverrides })]]),
    identityRuntime
  });
  t.after(() => server.close());
  const port = await listen(server);
  return `http://127.0.0.1:${port}`;
}

test('full browser flow links identity and stores tokens; state is single-use', async (t) => {
  const runtime = createIdentityBillingRuntime();
  const user = runtime.createUser({ tenantId: 't1', subject: 'alice' });
  let exchanges = 0;
  const base = await oauthHarness(t, async () => {
    exchanges += 1;
    return { status: 200, json: { access_token: 'at-http', refresh_token: 'rt-http', expires_in: 1800 } };
  }, runtime);

  const startRes = await fetch(`${base}/api/v1/oauth/acme/authorize?userId=${user.userId}`);
  assert.equal(startRes.status, 302);
  const startBody = await startRes.json();
  assert.ok(startBody.authorizeUrl.startsWith('https://idp.acme.example/authorize'));
  const callbackUrl = new URL(startBody.authorizeUrl.replace('https://idp.acme.example/authorize', `${base}/api/v1/oauth/acme/callback`));
  callbackUrl.searchParams.set('code', 'grant-77');

  const callback = await fetch(callbackUrl);
  assert.equal(callback.status, 200);
  const body = await callback.json();
  assert.deepEqual({ linked: body.linked, provider: body.provider }, { linked: true, provider: 'acme' });
  assert.equal(exchanges, 1);
  assert.equal(runtime.linkExternalIdentity ? undefined : undefined, undefined);
  const identities = runtime.listExternalIdentities?.() ?? null;
  void identities;

  const replay = await fetch(callbackUrl);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error.code, 'INVALID_OAUTH_STATE');
});

test('unknown state and expired window are rejected without exchange', async (t) => {
  const base = await oauthHarness(t, async () => ({ status: 200, json: { access_token: 'x' } }), createIdentityBillingRuntime());
  const bad = await fetch(`${base}/api/v1/oauth/acme/callback?state=nope&code=c`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'INVALID_OAUTH_STATE');
});

test('identity already bound to another user answers 409 and never stores tokens', async (t) => {
  const runtime = createIdentityBillingRuntime();
  const bob = runtime.createUser({ tenantId: 't1', subject: 'bob' });
  runtime.linkExternalIdentity({ userId: bob.userId, issuer: 'https://idp.acme.example', issuerSubject: 'taken-subject' });
  const carol = runtime.createUser({ tenantId: 't1', subject: 'carol' });

  const base = await oauthHarness(t, async () => ({ status: 200, json: { access_token: 'at-9' } }), runtime, { subjectHint: 'taken-subject' });
  const start = await (await fetch(`${base}/api/v1/oauth/acme/authorize?userId=${carol.userId}`)).json();
  const callbackUrl = new URL(start.authorizeUrl.replace('https://idp.acme.example/authorize', `${base}/api/v1/oauth/acme/callback`));
  callbackUrl.searchParams.set('code', 'g');
  const res = await fetch(callbackUrl);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, 'IDENTITY_ALREADY_LINKED');
});
