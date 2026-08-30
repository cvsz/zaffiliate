import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureApi } from '../apps/api/src/features-api.js';
import { runWithRequestPrincipal, getRequestPrincipal } from '../packages/security/src/request-principal.js';

function featureHarness() {
  const seen = [];
  const api = createFeatureApi({
    commerceStore: null,
    analyticsEvents: { summarize() { return {}; }, summarizeByProduct() { return new Map(); } },
    recommendationService: { async rankAndRecord() { return { modelVersion: 'v1', generatedAt: '', ranked: [], recommendations: [] }; } },
    recommendationStore: {
      list() { return []; },
      feedback(tenantId, recommendationId, input) {
        seen.push({ tenantId, recommendationId, input });
        return { recommendationId, status: 'accepted', feedback: input };
      }
    }
  });
  return { api, seen };
}

test('feature feedback ignores client actorId when a production principal exists', async () => {
  const { api, seen } = featureHarness();
  const result = await runWithRequestPrincipal(
    { tenantId: 'tenant-a', userId: 'usr_real', role: 'operator' },
    () => api.handle('/api/v1/intelligence/recommendations/rec-1/feedback', 'POST', 'tenant-a', {
      body: { decision: 'accept', actorId: 'usr_spoofed', reason: 'reviewed' }
    })
  );
  assert.equal(result.status, 200);
  assert.equal(seen[0].input.actorId, 'usr_real');
});

test('feature layer rejects a principal/tenant mismatch', async () => {
  const { api, seen } = featureHarness();
  const result = await runWithRequestPrincipal(
    { tenantId: 'tenant-a', userId: 'usr_real', role: 'operator' },
    () => api.handle('/api/v1/intelligence/recommendations/rec-1/feedback', 'POST', 'tenant-b', {
      body: { decision: 'accept', reason: 'wrong tenant' }
    })
  );
  assert.equal(result.status, 403);
  assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(seen.length, 0);
});

test('async local principals stay isolated across concurrent request contexts', async () => {
  const observed = await Promise.all([
    runWithRequestPrincipal({ tenantId: 't-a', userId: 'usr_a', role: 'admin' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getRequestPrincipal();
    }),
    runWithRequestPrincipal({ tenantId: 't-b', userId: 'usr_b', role: 'viewer' }, async () => {
      await Promise.resolve();
      return getRequestPrincipal();
    })
  ]);
  assert.deepEqual(observed[0], { tenantId: 't-a', userId: 'usr_a', role: 'admin' });
  assert.deepEqual(observed[1], { tenantId: 't-b', userId: 'usr_b', role: 'viewer' });
  assert.equal(getRequestPrincipal(), null);
});
