import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../apps/api/src/server.js';
import { createCommerceStore } from '../packages/affiliate-core/src/commerce.js';
import { createEventStore } from '../packages/analytics/src/events.js';
import { createFeatureStore, defineBaselineRanker } from '../packages/intelligence/src/index.js';
import { createRecommendationStore, createPredictionStore } from '../packages/intelligence/src/stores.js';

const TENANT = { 'x-tenant-id': 'org-A' };

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function harness(policyOverrides = {}) {
  const clock = () => new Date('2026-08-24T12:00:00.000Z').getTime();
  const commerceStore = createCommerceStore({ clock });
  const analyticsEvents = createEventStore();
  const featureStore = createFeatureStore({ clock });
  const recommendationStore = createRecommendationStore({ clock });
  const predictionStore = createPredictionStore({ clock });
  const ranker = defineBaselineRanker({ featureStore });
  const server = buildServer({
    env: { APP_ENV: 'development' },
    commerceStore, analyticsEvents, featureStore, recommendationStore, predictionStore,
    ranker,
    policyOverrides
  });
  void ranker;
  return { server };
}

test('automation status exposes mode and active kill switches', async (t) => {
  const { server } = harness();
  t.after(() => server.close());
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/automation/status`, { headers: TENANT });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'manual', 'default policy fails closed');
  assert.deepEqual(body.activeKillSwitches, []);
});

test('kill switch can be raised and then gates publish actions through the intelligence endpoint', async (t) => {
  const { server } = harness({ mode: 'autonomous', allowedPlatforms: ['tiktok'], allowAutoPublish: true });
  t.after(() => server.close());
  const port = await listen(server);
  const H = { ...TENANT, 'content-type': 'application/json' };

  const raise = await fetch(`http://127.0.0.1:${port}/api/v1/automation/kill-switch`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ scope: 'global', id: null, active: true, reason: 'deploy freeze', actorId: 'sec-op' })
  });
  assert.equal(raise.status, 200);

  const gated = await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/gate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      action: {
        type: 'publish_content', class: 'publish', platform: 'tiktok',
        campaignId: 'cmp_1', contentClass: 'product-demo',
        qualityScore: 90, complianceScore: 95, riskLevel: 'low'
      }
    })
  });
  const body = await gated.json();
  assert.equal(gated.status, 200);
  assert.equal(body.decision, 'DENY');
  assert.match(body.reason, /kill switch/i);
});

test('policy updates change gate outcomes without restart', async (t) => {
  const { server } = harness();
  t.after(() => server.close());
  const port = await listen(server);
  const H = { ...TENANT, 'content-type': 'application/json' };
  const action = {
    type: 'publish_content', class: 'publish', platform: 'tiktok',
    campaignId: 'cmp_2', contentClass: 'product-demo',
    qualityScore: 90, complianceScore: 95, riskLevel: 'low'
  };

  const before = await (await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/gate`, {
    method: 'POST', headers: H, body: JSON.stringify({ action })
  })).json();
  assert.equal(before.decision, 'DENY', 'fail-closed default: empty allowlist denies');

  await fetch(`http://127.0.0.1:${port}/api/v1/automation/policy`, {
    method: 'PUT', headers: H,
    body: JSON.stringify({
      mode: 'approval_required',
      allowedPlatforms: ['tiktok'],
      maxPostsPerDay: 10,
      minimumQualityScore: 70,
      minimumComplianceScore: 70
    })
  });

  const after = await (await fetch(`http://127.0.0.1:${port}/api/v1/intelligence/gate`, {
    method: 'POST', headers: H, body: JSON.stringify({ action })
  })).json();
  assert.equal(after.decision, 'APPROVAL_REQUIRED');
});

test('content factory surfaces: personas, briefs, scored hooks', async (t) => {
  const { server } = harness();
  t.after(() => server.close());
  const port = await listen(server);
  const H = { ...TENANT, 'content-type': 'application/json' };

  const personas = await (await fetch(`http://127.0.0.1:${port}/api/v1/content/personas`, { headers: TENANT })).json();
  assert.ok(personas.personas.length === 10);

  const briefRes = await fetch(`http://127.0.0.1:${port}/api/v1/content/briefs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      product: {
        title: 'Silk Sleep Mask', brand: 'Dreamline', category: 'sleep',
        priceMinorUnits: 59000, currency: 'THB', problem: 'light ruins sleep', outcome: 'faster sleep',
        benefits: [{ id: 'b1', text: 'blocks ambient light', evidenceRef: 'ev1' }],
        evidence: [{ id: 'ev1', source: 'spec sheet', statement: 'opaque panel' }]
      },
      personaId: 'budget-shopper', platform: 'tiktok', objective: 'clicks', tone: 'friendly', cta: 'Tap the link'
    })
  });
  assert.equal(briefRes.status, 200);
  const brief = (await briefRes.json()).brief;
  assert.ok(brief.briefId.startsWith('brf_'));

  const hooksRes = await fetch(`http://127.0.0.1:${port}/api/v1/content/hooks`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ briefId: brief.briefId, count: 20 })
  });
  const hooks = await hooksRes.json();
  assert.ok(hooks.hooks.length >= 20);
  assert.ok(hooks.hooks[0].scores.complianceRisk <= 100);

  const score = await fetch(`http://127.0.0.1:${port}/api/v1/content/score`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ text: 'Great mask for flights.', disclosure: '', platform: 'tiktok' })
  });
  const verdict = (await score.json()).score;
  assert.equal(verdict.verdict, 'revision_required', 'missing disclosure fails closed');
});
