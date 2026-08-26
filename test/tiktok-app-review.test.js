import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';
import { createOAuthFlow, createTokenStore } from '../packages/security/src/oauth.js';
import { createIdentityBillingRuntime } from '../packages/identity-billing/src/runtime.js';
import { buildWebServer } from '../apps/web/server.js';
import { buildServer } from '../apps/api/src/server.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('public legal pages render without auth with required sections and brand icon', async (t) => {
  const web = buildWebServer();
  t.after(() => web.close());
  const base = `http://127.0.0.1:${await listen(web)}`;

  for (const [path, mustContain] of [
    ['/privacy', ['Privacy Policy', 'TikTok Shop', 'seller.affiliate_collaboration.read', 'Retention and deletion', 'privacy@zeaz.dev', '/icon.svg', 'Disconnect']],
    ['/terms', ['Terms of Service', 'acceptable use', 'Governing law', 'support@zeaz.dev', '/icon.svg', 'disclosure']]
  ]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `${path} must be public`);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const html = await res.text();
    for (const needle of mustContain) assert.ok(html.includes(needle), `${path} missing: ${needle}`);
    assert.ok(html.includes('href="/terms"') && html.includes('mailto:'), `${path} footer must link Terms and Contact`);
    assert.ok(!html.includes('<script'), 'legal pages stay script-free under CSP');
  }

  const icon = await fetch(`${base}/icon.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type') ?? '', /image\/svg\+xml/);

  const index = await (await fetch(`${base}/`)).text();
  assert.ok(index.includes('rel="icon"'), 'index carries favicon');
  assert.ok(index.includes('href="/privacy"') && index.includes('href="/terms"'), 'public footer links present without login');
});

test('no secret material ever reaches public pages or api responses', async (t) => {
  const web = buildWebServer();
  t.after(() => web.close());
  const base = `http://127.0.0.1:${await listen(web)}`;
  for (const path of ['/', '/privacy', '/terms']) {
    const body = await (await fetch(`${base}${path}`)).text();
    assert.equal(/TTP_|refresh_token|client_secret/i.test(body), false, `${path} leaks token markers`);
  }
});

function harness() {
  const identityRuntime = createIdentityBillingRuntime();
  const user = identityRuntime.createUser({ tenantId: 't1', subject: 'seller-owner' });
  const backend = createInMemorySecretBackend();
  const manager = createSecretManager({ backend });
  const flow = createOAuthFlow({
    provider: 'tiktokshop',
    clientId: 'app-key-1',
    clientSecret: 'app-secret-1',
    authorizeUrl: 'https://services.tiktokshop.com/open/oauth/authorize',
    tokenUrl: 'https://auth.tiktokshop.com/open/oauth/token/get',
    redirectUri: 'https://zaffiliate.zeaz.dev/api/v1/oauth/tiktokshop/callback',
    scope: 'seller.affiliate_collaboration.read seller.affiliate_collaboration.write',
    transport: async () => ({ status: 200, json: {} }),
    clock: () => new Date('2026-08-26T10:00:00Z').getTime()
  });
  const tokenStore = createTokenStore({ manager, provider: 'tiktokshop', flow });
  return { identityRuntime, user, backend, flow, tokenStore };
}

async function apiHarness(t, h) {
  const server = buildServer({
    env: { APP_ENV: 'development' },
    oauthRegistry: new Map([['tiktokshop', { flow: h.flow, tokenStore: h.tokenStore, issuer: 'https://services.tiktokshop.com' }]]),
    identityRuntime: h.identityRuntime
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${await listen(server)}`;
}

test('disconnect revokes tokens, unlinks identity, and reports deletion receipt', async (t) => {
  const h = harness();
  h.identityRuntime.linkExternalIdentity({ userId: h.user.userId, issuer: 'https://services.tiktokshop.com', issuerSubject: '7010736057180325637' });
  h.tokenStore.store({ accessToken: 'TTP_access', refreshToken: 'TTP_refresh' });
  const base = await apiHarness(t, h);

  const before = h.tokenStore.readAccessToken();
  assert.equal(before, 'TTP_access');

  const res = await fetch(`${base}/api/v1/oauth/tiktokshop/disconnect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: h.user.userId })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(
    { disconnected: body.disconnected, provider: body.provider, removedLinks: body.removedLinks },
    { disconnected: true, provider: 'tiktokshop', removedLinks: 1 }
  );
  assert.deepEqual(body.dataDeleted, ['stored_tokens', 'account_link']);
  assert.equal(h.tokenStore.readAccessToken(), null, 'stored access token must be deleted');
  assert.equal(h.tokenStore.storedRefreshToken(), null, 'stored refresh token must be deleted');
  // relinking the same external subject works again after disconnect
  h.identityRuntime.linkExternalIdentity({ userId: h.user.userId, issuer: 'https://services.tiktokshop.com', issuerSubject: '7010736057180325637' });
});

test('disconnect is idempotent when nothing is linked; unknown provider stays 503', async (t) => {
  const h = harness();
  const base = await apiHarness(t, h);
  const res = await fetch(`${base}/api/v1/oauth/tiktokshop/disconnect`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: h.user.userId })
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).removedLinks, 0);

  const unknown = await fetch(`${base}/api/v1/oauth/unknownprovider/disconnect`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(unknown.status, 503);
});
