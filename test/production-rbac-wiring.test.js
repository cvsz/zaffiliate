import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createProductionServer } from '../apps/api/src/production-server.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function limiter() {
  return { async tryAcquire() { return { allowed: true, retryAfterMs: 0 }; } };
}

function localAuthService() {
  return {
    async login() { throw new Error('unused'); },
    async getSession({ tenantId, token }) {
      const roles = {
        zs_owner: 'owner', zs_admin: 'admin', zs_operator: 'operator', zs_affiliate: 'affiliate', zs_viewer: 'viewer', zs_service: 'service'
      };
      const role = roles[token];
      if (!role) return null;
      return { user: { tenantId, userId: `usr_${role}`, email: `${role}@example.test`, role }, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    async logout() { return { revoked: true }; },
    async listTenantUsers() { return []; },
    async listAuditEvents() { return []; },
    async requestPasswordReset() { return { accepted: true }; },
    async resetPassword() { return { reset: true }; },
    async requestEmailVerification() { return { accepted: true }; },
    async confirmEmailVerification() { return { verified: true }; }
  };
}

function oauthRepo() {
  return {
    async createPendingAuthorization() { throw new Error('unused'); },
    async consumePendingAuthorization() { return null; },
    async completeOAuthLink() { throw new Error('unused'); },
    async disconnectProvider() { return { removedIdentities: 0, removedTokenSets: 0 }; }
  };
}

async function harness(t) {
  const server = createProductionServer({
    env: { APP_ENV: 'development' },
    runtime: {},
    localAuthService: localAuthService(),
    oauthRegistry: new Map(),
    oauthRepository: oauthRepo(),
    rateLimiter: limiter(),
    db: {}
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function headers(token, json = false) {
  return {
    'x-tenant-id': TENANT,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'content-type': 'application/json' } : {})
  };
}

test('public health remains public while feature APIs require authentication', async (t) => {
  const base = await harness(t);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);

  const anonymous = await fetch(`${base}/api/v1/content/personas`, { headers: headers('') });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'UNAUTHENTICATED');

  const viewer = await fetch(`${base}/api/v1/content/personas`, { headers: headers('zs_viewer') });
  assert.equal(viewer.status, 200);

  const service = await fetch(`${base}/api/v1/content/personas`, { headers: headers('zs_service') });
  assert.equal(service.status, 403);
});

test('viewer cannot mutate automation while admin can', async (t) => {
  const base = await harness(t);
  const body = JSON.stringify({ mode: 'manual', organizationId: 'attacker-tenant' });
  const viewer = await fetch(`${base}/api/v1/automation/policy`, {
    method: 'PUT', headers: headers('zs_viewer', true), body
  });
  assert.equal(viewer.status, 403);

  const admin = await fetch(`${base}/api/v1/automation/policy`, {
    method: 'PUT', headers: headers('zs_admin', true), body
  });
  assert.equal(admin.status, 200);
});

test('content writes bind tenant to authenticated request instead of client body', async (t) => {
  const base = await harness(t);
  const response = await fetch(`${base}/api/v1/content/briefs`, {
    method: 'POST',
    headers: headers('zs_affiliate', true),
    body: JSON.stringify({
      tenantId: 'attacker-tenant',
      product: {
        title: 'Silk Sleep Mask', brand: 'Dreamline', category: 'sleep',
        priceMinorUnits: 59000, currency: 'THB', problem: 'light ruins sleep', outcome: 'faster sleep',
        benefits: [{ id: 'b1', text: 'blocks ambient light', evidenceRef: 'ev1' }],
        evidence: [{ id: 'ev1', source: 'spec sheet', statement: 'opaque panel' }]
      },
      personaId: 'budget-shopper', platform: 'tiktok', objective: 'clicks', tone: 'friendly', cta: 'Tap the link'
    })
  });
  assert.equal(response.status, 200);
  const brief = (await response.json()).brief;
  assert.equal(brief.tenantId, TENANT);
});
