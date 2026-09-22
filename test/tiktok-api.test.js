import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokApi } from '../apps/api/src/tiktok-api.js';
import { createIngressRateLimiter } from '../packages/security/src/rate-limit-api.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const USER_ID = 'usr_owner_1';
const ENCRYPTION_KEY = 'e'.repeat(32);
const CLIENT_KEY = 'sb_tiktok_client_key';
const CLIENT_SECRET = 's'.repeat(32);
const REDIRECT_URI = 'https://app.zaffiliate.com/api/v1/tiktok/auth/callback';

function mockReq({
  method = 'GET',
  url = '/',
  headers = {},
  body = null,
  ip = '127.0.0.1'
} = {}) {
  const req = {
    method,
    url,
    headers: {
      'x-tenant-id': TENANT_ID,
      authorization: 'Bearer valid_session_token',
      ...headers
    },
    socket: { remoteAddress: ip },
    async *[Symbol.asyncIterator]() {
      if (body != null) {
        yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      }
    }
  };
  return req;
}

function createHarness({
  accounts = [],
  sessionRole = 'owner',
  transport = null
} = {}) {
  const pendingMap = new Map();
  const storedAccounts = [...accounts];
  const publicationJobs = [];

  const localAuthService = {
    async getSession({ tenantId, token }) {
      if (token === 'valid_session_token') {
        return {
          session: { id: 'sess_1', userId: USER_ID },
          user: { userId: USER_ID, role: sessionRole }
        };
      }
      return null;
    }
  };

  const oauthRepo = {
    async createPendingAuthorization({ tenantId, userId, provider, stateHash, codeVerifierCiphertext, expiresAt }) {
      pendingMap.set(`${tenantId}:${stateHash}`, {
        tenantId,
        userId,
        provider,
        codeVerifierCiphertext,
        expiresAt
      });
      return { id: 'pending_1' };
    },
    async consumePendingAuthorization({ tenantId, provider, stateHash }) {
      const key = `${tenantId}:${stateHash}`;
      const found = pendingMap.get(key);
      if (found) pendingMap.delete(key);
      return found || null;
    }
  };

  const accountsRepo = {
    async upsertAccount(tenantId, data) {
      const existingIdx = storedAccounts.findIndex((a) => a.openId === data.openId);
      const acc = {
        id: existingIdx >= 0 ? storedAccounts[existingIdx].id : 'acc_tiktok_1',
        tenantId,
        ...data,
        tokenVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (existingIdx >= 0) storedAccounts[existingIdx] = acc;
      else storedAccounts.push(acc);
      return acc;
    },
    async getAccountById(tenantId, id) {
      return storedAccounts.find((a) => a.tenantId === tenantId && a.id === id) || null;
    },
    async listAccounts(tenantId, { status } = {}) {
      return storedAccounts.filter((a) => a.tenantId === tenantId && (!status || a.status === status));
    }
  };

  const tokenService = {
    encryptToken(val) {
      return `v1.mock.${val}`;
    },
    async getValidAccessToken({ tenantId, accountId }) {
      return { accessToken: 'act_live_token', refreshed: true, account: storedAccounts[0] };
    },
    async disconnectAccount({ tenantId, accountId }) {
      const acc = storedAccounts.find((a) => a.tenantId === tenantId && a.id === accountId);
      if (acc) acc.status = 'disconnected';
      return { disconnected: true, accountId };
    }
  };

  const publicationJobsRepo = {
    async create(tenantId, input) {
      const job = { id: 'pub_job_1', tenantId, ...input };
      publicationJobs.push(job);
      return { created: true, job, duplicate: false };
    }
  };

  const rateLimiter = createIngressRateLimiter({ requestsPerMinute: 1000, burst: 100 });

  const defaultTransport = async (url, init) => {
    if (url.includes('/oauth/token/')) {
      return {
        status: 200,
        json: async () => ({
          data: {
            access_token: 'act_tk_123',
            open_id: 'tt_open_999',
            refresh_token: 'rft_tk_123',
            expires_in: 86400,
            scope: 'user.info.basic,video.publish'
          },
          error: { code: 'ok' }
        })
      };
    }
    if (url.includes('/user/info/')) {
      return {
        status: 200,
        json: async () => ({
          data: {
            user: {
              open_id: 'tt_open_999',
              username: 'tiktok_star',
              display_name: 'TikTok Star',
              avatar_url: 'https://cdn.tiktok.com/avatar.jpg'
            }
          },
          error: { code: 'ok' }
        })
      };
    }
    return { status: 404 };
  };

  const api = createTikTokApi({
    accountsRepo,
    tokenService,
    oauthRepo,
    publicationJobsRepo,
    localAuthService,
    rateLimiter,
    clientKey: CLIENT_KEY,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    encryptionKey: ENCRYPTION_KEY,
    transport: transport || defaultTransport
  });

  return { api, accountsRepo, storedAccounts, publicationJobs };
}

test('GET /api/v1/tiktok/health returns status CONFIGURED and environment', async () => {
  const { api } = createHarness();
  const res = await api.handle({
    req: mockReq({ method: 'GET', url: '/api/v1/tiktok/health' }),
    pathname: '/api/v1/tiktok/health'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'tiktok-developer');
  assert.equal(res.body.status, 'CONFIGURED');
  assert.equal(res.body.features.oauth, true);
  assert.equal(res.body.features.publishing, true);
});

test('GET /api/v1/tiktok/auth/authorize requires auth, stores pending state, and returns 302', async () => {
  const { api } = createHarness();
  const unauthRes = await api.handle({
    req: mockReq({ headers: { authorization: '' } }),
    pathname: '/api/v1/tiktok/auth/authorize',
    tenantHeader: TENANT_ID
  });
  assert.equal(unauthRes.status, 401);

  const authRes = await api.handle({
    req: mockReq({ method: 'GET', url: '/api/v1/tiktok/auth/authorize' }),
    pathname: '/api/v1/tiktok/auth/authorize',
    tenantHeader: TENANT_ID
  });

  assert.equal(authRes.status, 302);
  assert.ok(authRes.headers.location.startsWith('https://www.tiktok.com/v2/auth/authorize/'));
  assert.ok(authRes.headers.location.includes(CLIENT_KEY));
  assert.ok(authRes.headers.location.includes(TENANT_ID));
});

test('GET /api/v1/tiktok/auth/callback handles OAuth code exchange, links account, and protects secret tokens', async () => {
  const { api, storedAccounts } = createHarness();

  // 1. First start authorize to get valid state
  const authRes = await api.handle({
    req: mockReq({ method: 'GET', url: '/api/v1/tiktok/auth/authorize' }),
    pathname: '/api/v1/tiktok/auth/authorize',
    tenantHeader: TENANT_ID
  });

  const loc = new URL(authRes.headers.location);
  const state = loc.searchParams.get('state');

  // 2. Callback with code and state
  const callbackRes = await api.handle({
    req: mockReq({ method: 'GET', url: `/api/v1/tiktok/auth/callback?code=mock_auth_code_123&state=${state}` }),
    pathname: '/api/v1/tiktok/auth/callback',
    tenantHeader: TENANT_ID
  });

  assert.equal(callbackRes.status, 200);
  assert.equal(callbackRes.body.linked, true);
  assert.equal(callbackRes.body.account.openId, 'tt_open_999');
  assert.equal(callbackRes.body.account.username, 'tiktok_star');

  // Verify that secrets are NEVER leaked in API response
  assert.equal(callbackRes.body.account.accessToken, undefined);
  assert.equal(callbackRes.body.account.refreshToken, undefined);
  assert.equal(callbackRes.body.account.accessTokenCiphertext, undefined);

  assert.equal(storedAccounts.length, 1);
  assert.equal(storedAccounts[0].openId, 'tt_open_999');
});

test('GET /api/v1/tiktok/auth/callback rejects replayed or unknown state', async () => {
  const { api } = createHarness();
  const res = await api.handle({
    req: mockReq({ method: 'GET', url: `/api/v1/tiktok/auth/callback?code=123&state=${TENANT_ID}.random_fake_state` }),
    pathname: '/api/v1/tiktok/auth/callback',
    tenantHeader: TENANT_ID
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_OAUTH_STATE');
});

test('GET /api/v1/tiktok/accounts lists sanitized accounts for tenant', async () => {
  const existingAcc = {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT_ID,
    userId: USER_ID,
    openId: 'tt_open_existing',
    username: 'existing_creator',
    displayName: 'Existing Creator',
    status: 'connected',
    accessTokenCiphertext: 'v1.enc.secret',
    refreshTokenCiphertext: 'v1.enc.secret'
  };

  const { api } = createHarness({ accounts: [existingAcc] });
  const res = await api.handle({
    req: mockReq({ method: 'GET', url: '/api/v1/tiktok/accounts' }),
    pathname: '/api/v1/tiktok/accounts',
    tenantHeader: TENANT_ID
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.accounts.length, 1);
  assert.equal(res.body.accounts[0].openId, 'tt_open_existing');
  assert.equal(res.body.accounts[0].accessTokenCiphertext, undefined);
});

test('POST /api/v1/tiktok/accounts/:id/disconnect disconnects account and requires admin/owner', async () => {
  const existingAcc = {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: TENANT_ID,
    userId: USER_ID,
    openId: 'tt_open_disconnect',
    status: 'connected'
  };

  const { api: viewerApi } = createHarness({ accounts: [existingAcc], sessionRole: 'viewer' });
  const forbiddenRes = await viewerApi.handle({
    req: mockReq({ method: 'POST', url: `/api/v1/tiktok/accounts/${existingAcc.id}/disconnect` }),
    pathname: `/api/v1/tiktok/accounts/${existingAcc.id}/disconnect`,
    tenantHeader: TENANT_ID
  });
  assert.equal(forbiddenRes.status, 403);

  const { api: ownerApi } = createHarness({ accounts: [existingAcc], sessionRole: 'owner' });
  const okRes = await ownerApi.handle({
    req: mockReq({ method: 'POST', url: `/api/v1/tiktok/accounts/${existingAcc.id}/disconnect` }),
    pathname: `/api/v1/tiktok/accounts/${existingAcc.id}/disconnect`,
    tenantHeader: TENANT_ID
  });
  assert.equal(okRes.status, 200);
  assert.equal(okRes.body.disconnected, true);
});

test('POST /api/v1/tiktok/publish validates input and enqueues publication job', async () => {
  const { api, publicationJobs } = createHarness();

  const badRes = await api.handle({
    req: mockReq({
      method: 'POST',
      url: '/api/v1/tiktok/publish',
      body: { title: 'Missing video url' }
    }),
    pathname: '/api/v1/tiktok/publish',
    tenantHeader: TENANT_ID
  });
  assert.equal(badRes.status, 400);

  const goodRes = await api.handle({
    req: mockReq({
      method: 'POST',
      url: '/api/v1/tiktok/publish',
      body: {
        title: 'Check this viral item! #ad',
        videoUrl: 'https://cdn.zaffiliate.com/viral.mp4'
      }
    }),
    pathname: '/api/v1/tiktok/publish',
    tenantHeader: TENANT_ID
  });

  assert.equal(goodRes.status, 201);
  assert.equal(publicationJobs.length, 1);
  assert.equal(publicationJobs[0].platform, 'tiktok');
  assert.equal(publicationJobs[0].providerResponse.title, 'Check this viral item! #ad');
});
