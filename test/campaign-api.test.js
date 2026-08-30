import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createCampaignApi } from '../apps/api/src/campaign-api.js';

const TENANT = '10000000-0000-4000-8000-000000000001';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const OTHER_CAMPAIGN = '22222222-2222-4222-8222-222222222222';

function request({ method = 'GET', url = '/', token = 'session-token', body } = {}) {
  const raw = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(raw);
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function fixture({ role = 'owner', active = true } = {}) {
  const calls = [];
  const campaigns = new Map([[CAMPAIGN, {
    tenantId: TENANT,
    campaignId: CAMPAIGN,
    name: 'Launch',
    status: active ? 'active' : 'draft',
    objective: null,
    budgetLimit: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
  }]]);
  const repo = {
    async listCampaigns() { return [...campaigns.values()]; },
    async getCampaign({ campaignId }) { return campaigns.get(campaignId) ?? null; },
    async createCampaign(input) {
      calls.push(['create', input]);
      return { ...campaigns.get(CAMPAIGN), campaignId: OTHER_CAMPAIGN, name: input.name, status: 'draft' };
    },
    async updateCampaign(input) { calls.push(['update', input]); return campaigns.get(input.campaignId); },
    async transitionCampaign(input) { calls.push(['transition', input]); return { ...campaigns.get(input.campaignId), status: input.to }; }
  };
  const affiliateRuntime = {
    async generateLink(tenantId, input) {
      calls.push(['link', { tenantId, ...input }]);
      return { tenantId, linkId: 'lnk_test', campaignId: input.campaignId };
    }
  };
  const localAuthService = {
    async getSession({ tenantId, token }) {
      if (tenantId !== TENANT || token !== 'session-token') return null;
      return { user: { userId: 'usr_test', role } };
    }
  };
  const rateLimiter = { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
  return { api: createCampaignApi({ repo, affiliateRuntime, localAuthService, rateLimiter }), calls };
}

test('campaign API requires tenant-bound bearer authentication', async () => {
  const { api } = fixture();
  const result = await api.handle({
    req: request({ token: '' }),
    pathname: '/api/v1/campaigns',
    tenantHeader: TENANT
  });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'UNAUTHENTICATED');
});

test('campaign writes require owner/admin role', async () => {
  const { api } = fixture({ role: 'viewer' });
  const result = await api.handle({
    req: request({ method: 'POST', url: '/api/v1/campaigns', body: { name: 'Denied' } }),
    pathname: '/api/v1/campaigns',
    tenantHeader: TENANT
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'CAMPAIGN_WRITE_FORBIDDEN');
});

test('campaign create binds actor and tenant from authenticated context', async () => {
  const { api, calls } = fixture();
  const result = await api.handle({
    req: request({ method: 'POST', url: '/api/v1/campaigns', body: { name: 'Q4 launch', objective: 'sales', budgetLimit: '1200.50' } }),
    pathname: '/api/v1/campaigns',
    tenantHeader: TENANT
  });
  assert.equal(result.status, 201);
  assert.equal(calls[0][0], 'create');
  assert.equal(calls[0][1].tenantId, TENANT);
  assert.equal(calls[0][1].actorId, 'usr_test');
});

test('campaign status transition uses URL campaign id', async () => {
  const { api, calls } = fixture();
  const result = await api.handle({
    req: request({ method: 'PATCH', url: `/api/v1/campaigns/${CAMPAIGN}/status`, body: { status: 'paused', campaignId: OTHER_CAMPAIGN } }),
    pathname: `/api/v1/campaigns/${CAMPAIGN}/status`,
    tenantHeader: TENANT
  });
  assert.equal(result.status, 200);
  assert.equal(calls[0][1].campaignId, CAMPAIGN);
  assert.equal(calls[0][1].to, 'paused');
});

test('campaign link creation is atomic and cannot override URL campaign id from body', async () => {
  const { api, calls } = fixture({ active: true });
  const result = await api.handle({
    req: request({
      method: 'POST',
      url: `/api/v1/campaigns/${CAMPAIGN}/links`,
      body: {
        campaignId: OTHER_CAMPAIGN,
        offerId: 'off_test',
        destinationUrl: 'https://example.com/product',
        subIds: ['subid']
      }
    }),
    pathname: `/api/v1/campaigns/${CAMPAIGN}/links`,
    tenantHeader: TENANT
  });
  assert.equal(result.status, 201);
  const linkCall = calls.find(([name]) => name === 'link');
  assert.ok(linkCall);
  assert.equal(linkCall[1].tenantId, TENANT);
  assert.equal(linkCall[1].campaignId, CAMPAIGN);
});

test('draft campaign cannot mint campaign-scoped affiliate links', async () => {
  const { api, calls } = fixture({ active: false });
  const result = await api.handle({
    req: request({ method: 'POST', url: `/api/v1/campaigns/${CAMPAIGN}/links`, body: { offerId: 'off_test', destinationUrl: 'https://example.com' } }),
    pathname: `/api/v1/campaigns/${CAMPAIGN}/links`,
    tenantHeader: TENANT
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'CAMPAIGN_NOT_ACTIVE');
  assert.equal(calls.some(([name]) => name === 'link'), false);
});
