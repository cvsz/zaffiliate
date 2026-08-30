import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthRegistryForEnv } from '../apps/api/src/oauth-runtime-factory.js';

function env(overrides = {}) {
  return {
    OAUTH_PROVIDER_ID: 'acme',
    OAUTH_CLIENT_ID: 'client-id',
    OAUTH_CLIENT_SECRET: 'client-secret',
    OAUTH_AUTHORIZE_URL: 'https://idp.example/authorize',
    OAUTH_TOKEN_URL: 'https://idp.example/token',
    OAUTH_REDIRECT_URI: 'https://app.example/api/v1/oauth/acme/callback',
    OAUTH_ISSUER: 'https://idp.example',
    OAUTH_SCOPE: 'read write',
    ...overrides
  };
}

test('oauth registry stays disabled when provider id is empty', () => {
  const registry = createOAuthRegistryForEnv({ env: {}, fetchImpl: async () => { throw new Error('unused'); } });
  assert.equal(registry.size, 0);
});

test('oauth registry fails closed on partial configuration and private token endpoints', () => {
  assert.throws(() => createOAuthRegistryForEnv({ env: env({ OAUTH_CLIENT_SECRET: '' }), fetchImpl: async () => {} }),
    (error) => error.code === 'OAUTH_CONFIG_INCOMPLETE');
  assert.throws(() => createOAuthRegistryForEnv({ env: env({ OAUTH_TOKEN_URL: 'https://127.0.0.1/token' }), fetchImpl: async () => {} }),
    (error) => error.code === 'SSRF_BLOCKED');
  assert.throws(() => createOAuthRegistryForEnv({ env: env({ OAUTH_AUTHORIZE_URL: 'https://localhost/authorize' }), fetchImpl: async () => {} }),
    (error) => error.code === 'SSRF_BLOCKED');
});

test('oauth registry constructs a public HTTPS provider without making a network call', () => {
  let calls = 0;
  const registry = createOAuthRegistryForEnv({
    env: env(),
    fetchImpl: async () => { calls += 1; throw new Error('unexpected network'); },
    clock: () => 1_760_000_000_000
  });
  assert.equal(registry.size, 1);
  assert.equal(registry.get('acme').issuer, 'https://idp.example/');
  const authorization = registry.get('acme').flow.createAuthorization();
  assert.ok(authorization.url.startsWith('https://idp.example/authorize'));
  assert.equal(calls, 0);
});

test('oauth token transport rejects oversized content-length before buffering the body', async () => {
  let textCalls = 0;
  const registry = createOAuthRegistryForEnv({
    env: env(),
    fetchImpl: async () => ({
      status: 200,
      headers: { get(name) { return String(name).toLowerCase() === 'content-length' ? String(1024 * 1024 + 1) : null; } },
      body: null,
      async text() { textCalls += 1; return '{"access_token":"must-not-be-read"}'; }
    })
  });
  const flow = registry.get('acme').flow;
  await assert.rejects(
    () => flow.exchangeCode({ authorization: flow.createAuthorization(), code: 'grant' }),
    /transport_failure/
  );
  assert.equal(textCalls, 0, 'oversized response must be rejected before response.text() buffers it');
});

test('oauth token transport cancels a streaming response as soon as the byte cap is exceeded', async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls === 1) controller.enqueue(new Uint8Array(700 * 1024));
      else if (pulls === 2) controller.enqueue(new Uint8Array(400 * 1024));
      else controller.close();
    },
    cancel() { cancelled = true; }
  });
  const registry = createOAuthRegistryForEnv({
    env: env(),
    fetchImpl: async () => ({
      status: 200,
      headers: { get() { return null; } },
      body,
      async text() { throw new Error('stream path must not call response.text()'); }
    })
  });
  const flow = registry.get('acme').flow;
  await assert.rejects(
    () => flow.exchangeCode({ authorization: flow.createAuthorization(), code: 'grant' }),
    /transport_failure/
  );
  assert.equal(cancelled, true);
  assert.equal(pulls, 2, 'reader must stop after crossing the 1MiB limit');
});
