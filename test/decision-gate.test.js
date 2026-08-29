import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationPolicy } from '../packages/automation/src/index.js';
import { setKillSwitch } from '../packages/automation/src/index.js';
import { createCommerceStore } from '../packages/affiliate-core/src/commerce.js';
import { createDecisionGate } from '../packages/intelligence/src/decision-gate.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();
const FRESH = new Date(NOW - 5 * 60 * 1000).toISOString();
const TENANT = 'org-A';

function harness(policyOverrides = {}) {
  const commerce = createCommerceStore({ clock: () => NOW });
  const offer = commerce.upsertOffer(TENANT, {
    provider: 'tiktok', providerOfferId: 'prov-1', merchantId: 'm1', productId: 'prod_1',
    currency: 'THB', listPriceMinorUnits: 100000, salePriceMinorUnits: 80000,
    inventoryStatus: 'IN_STOCK', source: 'catalog-sync', verifiedAt: FRESH
  });
  const policy = createAutomationPolicy({
    organizationId: TENANT,
    mode: 'autonomous',
    allowedPlatforms: ['tiktok'],
    maxPostsPerDay: 10,
    minimumQualityScore: 70,
    minimumComplianceScore: 70,
    allowAutoPublish: true,
    ...policyOverrides
  });
  return { commerce, offer, policy };
}

function baseAction(overrides = {}) {
  return {
    type: 'publish_content',
    class: 'publish',
    platform: 'tiktok',
    campaignId: 'cmp_1',
    contentClass: 'product-demo',
    qualityScore: 90,
    complianceScore: 95,
    riskLevel: 'low',
    estimatedCostMinorUnits: 0,
    commercialClaim: { type: 'PRICE', displayValue: '฿800', salePriceMinorUnits: 80000 },
    ...overrides
  };
}

function counters() {
  return { postsToday: () => 0, aiCostTodayMinorUnits: () => 0, campaignAiCostMinorUnits: () => 0 };
}

test('healthy candidates pass every gate: capability, commercial truth and policy', () => {
  const { commerce, offer, policy } = harness();
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId }),
    counters: counters(), context: { tenantId: TENANT, actorId: 'u1' }
  });
  assert.equal(outcome.decision, 'ALLOW');
  assert.equal(outcome.commercialRevalidation.decision, 'ALLOW');
  assert.equal(outcome.blockers.length, 0);
});

test('stale commercial claims deny publication regardless of model confidence', () => {
  const { commerce, offer, policy } = harness();
  commerce.recordPriceSnapshot(TENANT, offer.offerId, { listPriceMinorUnits: 100000, salePriceMinorUnits: 85000, observedAt: FRESH, source: 'sync' });
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId, commercialClaim: { type: 'PRICE', displayValue: '฿800', salePriceMinorUnits: 80000 } }),
    counters: counters(), context: { tenantId: TENANT }
  });
  assert.equal(outcome.decision, 'DENY');
  assert.match(outcome.blockers.join(' '), /stale_price|commercial/i);
});

test('active kill switches deny before any other consideration', () => {
  const { commerce, offer, policy } = harness();
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId }),
    counters: counters(),
    killSwitches: [setKillSwitch({ scope: 'global', id: null, active: true, reason: 'incident-42' })],
    context: { tenantId: TENANT }
  });
  assert.equal(outcome.decision, 'DENY');
  assert.match(outcome.reason, /kill switch/i);
});

test('approval-required policy converts ALLOW into APPROVAL_REQUIRED without blocking revalidation evidence', () => {
  const { commerce, offer, policy } = harness({ mode: 'approval_required' });
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId }),
    counters: counters(), context: { tenantId: TENANT }
  });
  assert.equal(outcome.decision, 'APPROVAL_REQUIRED');
  assert.equal(outcome.commercialRevalidation.decision, 'ALLOW');
});

test('cross-tenant recommendations are denied at the gate', () => {
  const { commerce, offer, policy } = harness();
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId }),
    counters: counters(),
    context: { tenantId: 'org-B', actorId: 'intruder' }
  });
  assert.equal(outcome.decision, 'DENY');
});

test('disallowed platforms are denied by capability policy inside the gate', () => {
  const { commerce, offer, policy } = harness();
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId, platform: 'youtube' }),
    counters: counters(), context: { tenantId: TENANT }
  });
  assert.equal(outcome.decision, 'DENY');
  assert.match(outcome.reason, /platform not allowed/i);
});

test('expired promotion bindings deny through the same gate', () => {
  const { commerce, offer, policy } = harness();
  const promotion = commerce.upsertPromotion(TENANT, {
    type: 'FLASH_SALE', offerId: offer.offerId,
    startsAt: '2026-08-24T08:00:00.000Z', endsAt: '2026-08-24T09:00:00.000Z'
  });
  const gate = createDecisionGate({ commerceStore: commerce });
  const outcome = gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId, commercialClaim: { type: 'PROMOTION', displayValue: 'Flash!', promotionId: promotion.promotionId } }),
    counters: counters(), context: { tenantId: TENANT },
    now: new Date('2026-08-24T10:00:00.000Z').toISOString()
  });
  assert.equal(outcome.decision, 'DENY');
  assert.match(outcome.blockers.join(' '), /promotion_expired/i);
});

test('gated decisions are auditable through the injected sink', () => {
  const events = [];
  const { commerce, offer, policy } = harness({ mode: 'approval_required' });
  const gate = createDecisionGate({ commerceStore: commerce, auditSink: (event) => events.push(event) });
  gate.evaluate({
    policy, action: baseAction({ offerId: offer.offerId }),
    counters: counters(), context: { tenantId: TENANT, actorId: 'u1' }
  });
  const gateEvents = events.filter((event) => event.action === 'intelligence.gate_decision');
  assert.equal(gateEvents.length, 1);
  assert.equal(gateEvents[0].detail.gateDecision, 'APPROVAL_REQUIRED');
});
