import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePkceBundle,
  generateOAuthState,
  buildTikTokAuthorizationUrl,
  normalizeTikTokTokenPayload,
  exchangeTikTokCode,
  refreshTikTokToken,
  revokeTikTokToken,
  fetchTikTokUserInfo,
  TikTokOAuthError,
  createTikTokTokenService
} from '../packages/tiktok-developer/src/index.js';

const CLIENT_KEY = 'sb_test_client_key_12345';
const CLIENT_SECRET = 's'.repeat(32);
const ENCRYPTION_KEY = 'k'.repeat(32);
const REDIRECT_URI = 'https://app.zaffiliate.com/api/v1/tiktok/auth/callback';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';

test('generatePkceBundle produces valid verifier and S256 challenge', () => {
  const pkce = generatePkceBundle();
  assert.equal(typeof pkce.codeVerifier, 'string');
  assert.equal(typeof pkce.codeChallenge, 'string');
  assert.equal(pkce.codeChallengeMethod, 'S256');
  assert.ok(pkce.codeVerifier.length >= 43);
  assert.ok(pkce.codeChallenge.length >= 43);
});

test('buildTikTokAuthorizationUrl builds correct TikTok v2 authorize URL with PKCE', () => {
  const state = generateOAuthState();
  const pkce = generatePkceBundle();
  const urlString = buildTikTokAuthorizationUrl({
    clientKey: CLIENT_KEY,
    redirectUri: REDIRECT_URI,
    scopes: ['user.info.basic', 'video.publish'],
    state,
    codeChallenge: pkce.codeChallenge
  });

  const url = new URL(urlString);
  assert.equal(url.origin, 'https://www.tiktok.com');
  assert.equal(url.pathname, '/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), CLIENT_KEY);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('state'), state);
  assert.equal(url.searchParams.get('code_challenge'), pkce.codeChallenge);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('buildTikTokAuthorizationUrl rejects insecure or private redirect URIs fail-closed', () => {
  assert.throws(
    () => buildTikTokAuthorizationUrl({
      clientKey: CLIENT_KEY,
      redirectUri: 'http://insecure.example.com',
      state: 'xyz',
      codeChallenge: 'abc'
    }),
    /scheme "http" is not allowed/
  );

  assert.throws(
    () => buildTikTokAuthorizationUrl({
      clientKey: CLIENT_KEY,
      redirectUri: 'https://127.0.0.1/callback',
      state: 'xyz',
      codeChallenge: 'abc'
    }),
    /private host blocked/
  );
});

test('normalizeTikTokTokenPayload extracts tokens and dates accurately', () => {
  const now = 1700000000000;
  const raw = {
    data: {
      access_token: 'act_123456789',
      expires_in: 86400,
      open_id: 'open_user_999',
      refresh_expires_in: 31536000,
      refresh_token: 'rft_987654321',
      scope: 'user.info.basic,video.publish',
      token_type: 'Bearer'
    },
    error: {
      code: 'ok',
      message: ''
    }
  };

  const normalized = normalizeTikTokTokenPayload(raw, () => now);
  assert.equal(normalized.accessToken, 'act_123456789');
  assert.equal(normalized.refreshToken, 'rft_987654321');
  assert.equal(normalized.openId, 'open_user_999');
  assert.equal(normalized.expiresAt, now + 86400 * 1000);
  assert.equal(normalized.refreshExpiresAt, now + 31536000 * 1000);
});

test('normalizeTikTokTokenPayload fails closed on provider error', () => {
  const errPayload = {
    error: {
      code: 'invalid_client',
      message: 'Invalid client key or secret'
    }
  };

  assert.throws(
    () => normalizeTikTokTokenPayload(errPayload),
    (err) => err instanceof TikTokOAuthError && err.code === 'TIKTOK_PROVIDER_ERROR'
  );
});

test('exchangeTikTokCode posts urlencoded payload with client_key and code_verifier', async () => {
  let capturedUrl = null;
  let capturedBody = null;

  const transport = async (url, init) => {
    capturedUrl = url;
    capturedBody = new URLSearchParams(init.body);
    return {
      status: 200,
      json: async () => ({
        data: {
          access_token: 'act_exchanged',
          open_id: 'open_123',
          expires_in: 3600,
          refresh_token: 'rft_exchanged',
          scope: 'user.info.basic'
        },
        error: { code: 'ok' }
      })
    };
  };

  const result = await exchangeTikTokCode({
    clientKey: CLIENT_KEY,
    clientSecret: CLIENT_SECRET,
    code: 'auth_code_abc',
    redirectUri: REDIRECT_URI,
    codeVerifier: 'verifier_bundle_123',
    transport
  });

  assert.equal(capturedUrl, 'https://open.tiktokapis.com/v2/oauth/token/');
  assert.equal(capturedBody.get('client_key'), CLIENT_KEY);
  assert.equal(capturedBody.get('client_secret'), CLIENT_SECRET);
  assert.equal(capturedBody.get('grant_type'), 'authorization_code');
  assert.equal(capturedBody.get('code'), 'auth_code_abc');
  assert.equal(capturedBody.get('code_verifier'), 'verifier_bundle_123');
  assert.equal(result.accessToken, 'act_exchanged');
  assert.equal(result.openId, 'open_123');
});

test('refreshTikTokToken refreshes and classifies invalid_grant as REAUTH_REQUIRED', async () => {
  const successTransport = async () => ({
    status: 200,
    json: async () => ({
      data: {
        access_token: 'act_refreshed',
        open_id: 'open_123',
        expires_in: 3600,
        refresh_token: 'rft_rotated',
        scope: 'user.info.basic'
      },
      error: { code: 'ok' }
    })
  });

  const successResult = await refreshTikTokToken({
    clientKey: CLIENT_KEY,
    clientSecret: CLIENT_SECRET,
    refreshToken: 'old_refresh',
    transport: successTransport
  });
  assert.equal(successResult.accessToken, 'act_refreshed');
  assert.equal(successResult.refreshToken, 'rft_rotated');

  const revokedTransport = async () => ({
    status: 400,
    json: async () => ({
      error: { code: 'invalid_grant', message: 'Refresh token expired or revoked' }
    })
  });

  await assert.rejects(
    async () => refreshTikTokToken({
      clientKey: CLIENT_KEY,
      clientSecret: CLIENT_SECRET,
      refreshToken: 'bad_token',
      transport: revokedTransport
    }),
    (err) => err.code === 'REAUTH_REQUIRED'
  );
});

test('fetchTikTokUserInfo sends bearer authorization and returns creator profile', async () => {
  let authHeader = null;
  const transport = async (url, init) => {
    authHeader = init.headers.authorization;
    return {
      status: 200,
      json: async () => ({
        data: {
          user: {
            open_id: 'tt_open_456',
            union_id: 'tt_union_456',
            avatar_url: 'https://cdn.tiktok.com/avatar.jpg',
            display_name: 'Affiliate Creator',
            username: 'affiliate_star'
          }
        },
        error: { code: 'ok' }
      })
    };
  };

  const profile = await fetchTikTokUserInfo({
    accessToken: 'act_my_token',
    transport
  });

  assert.equal(authHeader, 'Bearer act_my_token');
  assert.equal(profile.openId, 'tt_open_456');
  assert.equal(profile.username, 'affiliate_star');
  assert.equal(profile.displayName, 'Affiliate Creator');
});

test('TikTokTokenService encrypts tokens, performs automatic refresh when expiring, and protects secrets', async () => {
  let storedAccount = {
    id: 'acc_123',
    tenant_id: TENANT_ID,
    open_id: 'tt_open_123',
    status: 'connected',
    access_token_ciphertext: null,
    refresh_token_ciphertext: null,
    token_expires_at: new Date(Date.now() - 1000).toISOString() // expired
  };

  const fakeRepo = {
    async getAccountById(tenant, id) {
      assert.equal(tenant, TENANT_ID);
      assert.equal(id, 'acc_123');
      return {
        id: storedAccount.id,
        tenantId: storedAccount.tenant_id,
        openId: storedAccount.open_id,
        status: storedAccount.status,
        accessTokenCiphertext: storedAccount.access_token_ciphertext,
        refreshTokenCiphertext: storedAccount.refresh_token_ciphertext,
        tokenExpiresAt: storedAccount.token_expires_at
      };
    },
    async refreshTokenWithLock(tenant, id, refreshFn) {
      const account = await this.getAccountById(tenant, id);
      const newTokens = await refreshFn(account);
      storedAccount.access_token_ciphertext = newTokens.accessTokenCiphertext;
      storedAccount.refresh_token_ciphertext = newTokens.refreshTokenCiphertext;
      storedAccount.token_expires_at = newTokens.tokenExpiresAt;
      return {
        refreshed: true,
        reused: false,
        account: await this.getAccountById(tenant, id)
      };
    },
    async disconnectAccount(tenant, id) {
      storedAccount.status = 'disconnected';
      return { disconnected: true };
    }
  };

  const tokenService = createTikTokTokenService({
    repo: fakeRepo,
    encryptionKey: ENCRYPTION_KEY,
    clientKey: CLIENT_KEY,
    clientSecret: CLIENT_SECRET,
    transport: async () => ({
      status: 200,
      json: async () => ({
        data: {
          access_token: 'new_active_access_token',
          open_id: 'tt_open_123',
          expires_in: 7200,
          refresh_token: 'new_active_refresh_token'
        },
        error: { code: 'ok' }
      })
    })
  });

  // Seed with initial encrypted refresh token
  storedAccount.refresh_token_ciphertext = tokenService.encryptToken('initial_refresh_token', {
    tenantId: TENANT_ID,
    accountId: 'acc_123',
    kind: 'refresh'
  });
  storedAccount.access_token_ciphertext = tokenService.encryptToken('old_expired_access_token', {
    tenantId: TENANT_ID,
    accountId: 'acc_123',
    kind: 'access'
  });

  const active = await tokenService.getValidAccessToken({
    tenantId: TENANT_ID,
    accountId: 'acc_123'
  });

  assert.equal(active.refreshed, true);
  assert.equal(active.accessToken, 'new_active_access_token');
  // Stored token is encrypted ciphertext, NOT plaintext
  assert.notEqual(storedAccount.access_token_ciphertext, 'new_active_access_token');
  assert.ok(storedAccount.access_token_ciphertext.startsWith('v1.')); // AES-GCM envelope format (v1.iv.tag.ciphertext)

  // Second retrieval without expiration should NOT refresh
  const cached = await tokenService.getValidAccessToken({
    tenantId: TENANT_ID,
    accountId: 'acc_123'
  });
  assert.equal(cached.refreshed, false);
  assert.equal(cached.accessToken, 'new_active_access_token');
});
