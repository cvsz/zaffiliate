import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProductionServer } from '../apps/api/src/production-server.js';

const TENANT = '10000000-0000-4000-8000-000000000001';

function dependencies() {
  const campaign = {
    tenantId: TENANT,
    campaignId: '11111111-1111-4111-8111-111111111111',
    name: 'Production wired',
    status: 'draft',
    objective: null,
    budgetLimit: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
  };
  return {
    env: {
      APP_ENV: 'test',
      PORT: '8080',
      SESSION_SECRET: 's'.repeat(64)
    },
    db: {},
    runtime: {
      async generateLink() { return { linkId: 'lnk_test' }; }
    },
    localAuthService: {
      async login() {
        throw new Error('login is not exercised by campaign production wiring test');
      },
      async getSession({ tenantId, token }) {
        if (tenantId !== TENANT || token !== 'session-token') return null;
        return { user: { userId: 'usr_test', role: 'owner' } };
      }
    },
    oauthRegistry: new Map(),
    oauthRepository: { async createPendingAuthorization() {} },
    oauthLoginRepository: {
      async createPendingLogin() {},
      async consumePendingLogin() { return null; },
      async completeOidcLogin() { return null; }
    },
    campaignRepository: {
      async createCampaign() { return campaign; },
      async listCampaigns() { return [campaign]; },
      async getCampaign() { return campaign; },
      async updateCampaign() { return campaign; },
      async transitionCampaign() { return campaign; }
    },
    rateLimiter: { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } }
  };
}

test('production server routes authenticated campaign requests through campaign API', async (t) => {
  const server = createProductionServer(dependencies());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/campaigns`, {
    headers: {
      authorization: 'Bearer session-token',
      'x-tenant-id': TENANT
    }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].name, 'Production wired');
});
