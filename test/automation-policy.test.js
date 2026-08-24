import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAutomationPolicy,
  evaluateAction,
  setKillSwitch,
  listKillSwitches,
  DECISIONS
} from '../packages/automation/src/index.js';

function basePolicy(overrides = {}) {
  return createAutomationPolicy({
    organizationId: 'org-A',
    mode: 'autonomous',
    allowedPlatforms: ['tiktok', 'instagram'],
    maxPostsPerDay: 10,
    maxAiCostPerDayMinorUnits: 100000,
    minimumQualityScore: 70,
    minimumComplianceScore: 70,
    allowAutoPublish: true,
    ...overrides
  });
}

const PUBLISH_ACTION = {
  type: 'publish_content',
  class: 'publish',
  platform: 'tiktok',
  campaignId: 'cmp_1',
  contentClass: 'product-demo',
  qualityScore: 90,
  complianceScore: 95,
  riskLevel: 'low',
  estimatedCostMinorUnits: 0
};

function counters(overrides = {}) {
  return {
    postsToday: () => 0,
    aiCostTodayMinorUnits: () => 0,
    campaignAiCostMinorUnits: () => 0,
    ...overrides
  };
}

test('policies are versioned, frozen and default to manual with nothing enabled', () => {
  const policy = createAutomationPolicy({ organizationId: 'org-A' });
  assert.equal(policy.version, 1);
  assert.ok(Object.isFrozen(policy));
  assert.equal(policy.mode, 'manual');
  assert.equal(policy.allowAutoPublish, false);
  assert.equal(policy.allowProductAutoSelection, false);
});

test('unknown modes and malformed policies are rejected at creation', () => {
  assert.throws(() => createAutomationPolicy({ organizationId: 'org-A', mode: 'yolo' }), /unsupported automation mode/i);
  assert.throws(() => createAutomationPolicy({}), /organizationId is required/i);
});

test('MANUAL mode routes publishing actions to a human instead of denying outright', () => {
  const policy = basePolicy({ mode: 'manual' });
  const decision = evaluateAction({ policy, action: PUBLISH_ACTION, counters: counters() });
  assert.equal(decision.decision, DECISIONS.MANUAL_REQUIRED);
  assert.match(decision.reason, /manual mode/);
});

test('DRAFT_ONLY permits generation but never publishing', () => {
  const policy = basePolicy({ mode: 'draft_only' });
  const generation = { ...PUBLISH_ACTION, type: 'generate_variant', class: 'draft' };
  assert.equal(evaluateAction({ policy, action: generation, counters: counters() }).decision, DECISIONS.ALLOW);
  const publish = evaluateAction({ policy, action: PUBLISH_ACTION, counters: counters() });
  assert.equal(publish.decision, DECISIONS.DENY);
  assert.match(publish.reason, /never publish/i);
});

test('APPROVAL_REQUIRED mode routes publishing through human approval', () => {
  const policy = basePolicy({ mode: 'approval_required' });
  const decision = evaluateAction({ policy, action: PUBLISH_ACTION, counters: counters() });
  assert.equal(decision.decision, DECISIONS.APPROVAL_REQUIRED);
  assert.equal(decision.requiredApprover, 'human');
});

test('AUTO_SAFE publishes only pre-approved content classes', () => {
  const approved = basePolicy({ mode: 'auto_safe', preApprovedContentClasses: ['product-demo'] });
  assert.equal(evaluateAction({ policy: approved, action: PUBLISH_ACTION, counters: counters() }).decision, DECISIONS.ALLOW);

  const unlisted = basePolicy({ mode: 'auto_safe', preApprovedContentClasses: ['comparison'] });
  const decision = evaluateAction({ policy: unlisted, action: PUBLISH_ACTION, counters: counters() });
  assert.equal(decision.decision, DECISIONS.APPROVAL_REQUIRED);
  assert.match(decision.reason, /content class not pre-approved/i);
});

test('disallowed platforms are denied regardless of autonomy level', () => {
  const policy = basePolicy();
  const decision = evaluateAction({ policy, action: { ...PUBLISH_ACTION, platform: 'youtube' }, counters: counters() });
  assert.equal(decision.decision, DECISIONS.DENY);
  assert.match(decision.reason, /platform not allowed/i);
});

test('quality and compliance score floors are enforced even in autonomous mode', () => {
  const policy = basePolicy();
  const lowQuality = evaluateAction({ policy, action: { ...PUBLISH_ACTION, qualityScore: 50 }, counters: counters() });
  assert.equal(lowQuality.decision, DECISIONS.DENY);
  const lowCompliance = evaluateAction({ policy, action: { ...PUBLISH_ACTION, complianceScore: 40 }, counters: counters() });
  assert.equal(lowCompliance.decision, DECISIONS.DENY);
});

test('risk routing sends critical risk to denial and high risk to specialist approval', () => {
  const policy = basePolicy();
  const critical = evaluateAction({ policy, action: { ...PUBLISH_ACTION, riskLevel: 'critical' }, counters: counters() });
  assert.equal(critical.decision, DECISIONS.DENY);
  const high = evaluateAction({ policy, action: { ...PUBLISH_ACTION, riskLevel: 'high' }, counters: counters() });
  assert.equal(high.decision, DECISIONS.APPROVAL_REQUIRED);
  assert.equal(high.requiredApprover, 'specialist');
});

test('daily budget exhaustion denies and campaign budget exhaustion requests approval', () => {
  const policy = basePolicy();
  const exhausted = counters({ aiCostTodayMinorUnits: () => 200000 });
  assert.equal(evaluateAction({ policy, action: PUBLISH_ACTION, counters: exhausted }).decision, DECISIONS.DENY);

  const overCampaign = counters({
    campaignAiCostMinorUnits: () => 100000,
    aiCostPerCampaignMinorUnits: 50000
  });
  const campaignDecision = evaluateAction({
    policy: basePolicy({ maxAiCostPerCampaignMinorUnits: 50000 }),
    action: PUBLISH_ACTION,
    counters: overCampaign
  });
  assert.equal(campaignDecision.decision, DECISIONS.APPROVAL_REQUIRED);
});

test('frequency caps block posting beyond the daily allowance', () => {
  const policy = basePolicy({ maxPostsPerDay: 2 });
  const usedUp = counters({ postsToday: () => 2 });
  const decision = evaluateAction({ policy, action: PUBLISH_ACTION, counters: usedUp });
  assert.equal(decision.decision, DECISIONS.DEFER);
  assert.match(decision.reason, /daily post cap/i);
});

test('cross-tenant evaluation is denied and audited as such', () => {
  const policy = basePolicy();
  const decision = evaluateAction({ policy, action: PUBLISH_ACTION, counters: counters(), context: { tenantId: 'org-B', actorId: 'u9' } });
  assert.equal(decision.decision, DECISIONS.DENY);
  assert.match(decision.reason, /cross[- ]tenant/i);
});

test('kill switches deny new actions at global, organization and provider scope', () => {
  const globalSwitch = setKillSwitch({ scope: 'global', id: null, active: true, reason: 'incident-42' });
  const globalDecision = evaluateAction({ policy: basePolicy(), action: PUBLISH_ACTION, counters: counters(), killSwitches: [globalSwitch] });
  assert.equal(globalDecision.decision, DECISIONS.DENY);
  assert.match(globalDecision.reason, /kill switch/i);

  const orgSwitch = setKillSwitch({ scope: 'organization', id: 'org-A', active: true, reason: 'pause-org' });
  const orgDecision = evaluateAction({ policy: basePolicy(), action: PUBLISH_ACTION, counters: counters(), killSwitches: [orgSwitch] });
  assert.equal(orgDecision.decision, DECISIONS.DENY);

  const otherOrg = evaluateAction({ policy: basePolicy({ organizationId: 'org-C' }), action: PUBLISH_ACTION, counters: counters(), killSwitches: [orgSwitch], context: { tenantId: 'org-C', actorId: 'u1' } });
  assert.notEqual(otherOrg.decision, DECISIONS.DENY);

  const providerSwitch = setKillSwitch({ scope: 'provider', id: 'tiktok', active: true, reason: 'provider-outage' });
  const providerDecision = evaluateAction({ policy: basePolicy(), action: PUBLISH_ACTION, counters: counters(), killSwitches: [providerSwitch] });
  assert.equal(providerDecision.decision, DECISIONS.DENY);
  assert.match(providerDecision.reason, /tiktok/i);
});

test('deactivating a switch restores flow and switches remain inspectable', () => {
  const active = setKillSwitch({ scope: 'campaign', id: 'cmp_1', active: true, reason: 'fatigue-pause' });
  assert.equal(listKillSwitches([active]).length, 1);
  const off = setKillSwitch({ ...active, active: false });
  const cleared = listKillSwitches([off]);
  assert.equal(cleared.length, 0);
  const decision = evaluateAction({ policy: basePolicy(), action: PUBLISH_ACTION, counters: counters(), killSwitches: [off] });
  assert.equal(decision.decision, DECISIONS.ALLOW);
});

test('every decision carries check-level explanations and policy version', () => {
  const policy = basePolicy({ mode: 'approval_required' });
  const decision = evaluateAction({ policy, action: PUBLISH_ACTION, counters: counters() });
  assert.equal(decision.policyVersion, policy.version);
  const names = decision.checks.map((entry) => entry.check);
  assert.ok(names.includes('mode'));
  assert.ok(names.includes('platform'));
  assert.ok(names.includes('kill_switch'));
  assert.ok(decision.decidedAt);
});

test('audit sink receives every decision including denials', () => {
  const events = [];
  const policy = basePolicy({ mode: 'approval_required' });
  evaluateAction({
    policy,
    action: PUBLISH_ACTION,
    counters: counters(),
    auditSink: (event) => events.push(event),
    context: { tenantId: 'org-A', actorId: 'u1' }
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'automation.decision');
  assert.equal(events[0].detail.decision, DECISIONS.APPROVAL_REQUIRED);
  assert.equal(events[0].tenantId, 'org-A');
});

test('dry-run computes real decisions while marking zero side effects', () => {
  const events = [];
  const policy = basePolicy({ dryRun: true });
  const decision = evaluateAction({
    policy,
    action: PUBLISH_ACTION,
    counters: counters(),
    auditSink: (event) => events.push(event)
  });
  assert.equal(decision.decision, DECISIONS.ALLOW);
  assert.equal(decision.dryRun, true);
  assert.equal(events[0].detail.dryRun, true);
});
