export const DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  MANUAL_REQUIRED: 'MANUAL_REQUIRED',
  DENY: 'DENY',
  DEFER: 'DEFER'
});

export const AUTOMATION_MODES = Object.freeze([
  'manual',
  'assisted',
  'draft_only',
  'approval_required',
  'auto_safe',
  'autonomous'
]);

export const KILL_SWITCH_SCOPES = Object.freeze([
  'global',
  'organization',
  'provider',
  'account',
  'campaign',
  'workflow'
]);

const PUBLISH_CLASSES = Object.freeze(['publish']);
const GENERATION_CLASSES = Object.freeze(['draft']);

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function positiveInt(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function createAutomationPolicy({
  organizationId,
  mode = 'manual',
  allowedPlatforms = [],
  allowedCategories = null,
  maxPostsPerDay = 0,
  maxPostsPerPlatformPerDay = null,
  maxAiCostPerDayMinorUnits = 0,
  maxAiCostPerCampaignMinorUnits = null,
  minimumQualityScore = 100,
  minimumComplianceScore = 100,
  preApprovedContentClasses = [],
  allowProductAutoSelection = false,
  allowCampaignAutoCreation = false,
  allowCreativeAutoGeneration = false,
  allowAutoPublish = false,
  allowAutoOptimization = false,
  dryRun = false
} = {}) {
  requireText(organizationId, 'organizationId');
  const normalizedMode = String(mode).trim().toLowerCase();
  if (!AUTOMATION_MODES.includes(normalizedMode)) throw new Error(`unsupported automation mode: ${mode}`);
  for (const [key, value] of Object.entries({ maxPostsPerDay, maxAiCostPerDayMinorUnits })) {
    if (positiveInt(value) == null) throw new Error(`${key} must be a non-negative integer`);
  }

  return Object.freeze({
    version: 1,
    organizationId: String(organizationId).trim(),
    mode: normalizedMode,
    allowedPlatforms: Object.freeze([...new Set(allowedPlatforms.map((platform) => String(platform).trim().toLowerCase()))]),
    allowedCategories: allowedCategories == null ? null : Object.freeze([...allowedCategories]),
    maxPostsPerDay,
    maxPostsPerPlatformPerDay: maxPostsPerPlatformPerDay == null ? null : Number(maxPostsPerPlatformPerDay),
    maxAiCostPerDayMinorUnits,
    maxAiCostPerCampaignMinorUnits: maxAiCostPerCampaignMinorUnits == null ? null : Number(maxAiCostPerCampaignMinorUnits),
    minimumQualityScore,
    minimumComplianceScore,
    preApprovedContentClasses: Object.freeze([...preApprovedContentClasses]),
    allowProductAutoSelection,
    allowCampaignAutoCreation,
    allowCreativeAutoGeneration,
    allowAutoPublish,
    allowAutoOptimization,
    quietHours: null,
    killSwitchActive: false,
    dryRun: Boolean(dryRun)
  });
}

export function setKillSwitch({ scope, id = null, active = true, reason, setAt = new Date().toISOString() }) {
  if (!KILL_SWITCH_SCOPES.includes(String(scope))) throw new Error(`unsupported kill switch scope: ${scope}`);
  if (scope !== 'global') requireText(id, `id for scope ${scope}`);
  requireText(reason, 'reason');
  return Object.freeze({ scope: String(scope), id: id == null ? null : String(id), active: Boolean(active), reason, setAt });
}

export function listKillSwitches(switches) {
  return (switches ?? []).filter((entry) => entry?.active);
}

function switchBlocks(killSwitches, { organizationId, platform, campaignId }) {
  for (const entry of listKillSwitches(killSwitches)) {
    if (entry.scope === 'global') return entry;
    if (entry.scope === 'organization' && entry.id === organizationId) return entry;
    if (entry.scope === 'provider' && platform && entry.id === platform) return entry;
    if (entry.scope === 'campaign' && campaignId && entry.id === campaignId) return entry;
  }
  return null;
}

function check(name, result = null) {
  return { check: name, result };
}

export function evaluateAction({
  policy,
  action,
  counters,
  killSwitches = [],
  context = {},
  auditSink = null,
  now = new Date().toISOString()
}) {
  const checks = [];
  let decision = DECISIONS.ALLOW;
  let reason = 'allowed by policy';
  let requiredApprover = null;

  const tenantId = String(context.tenantId ?? policy.organizationId).trim();
  const actorId = String(context.actorId ?? 'system').trim();

  const record = (outcome) => {
    checks.push(check(outcome, reason));
  };

  const deny = (why) => {
    decision = DECISIONS.DENY;
    reason = why;
  };
  const defer = (why) => {
    decision = decision === DECISIONS.DENY ? decision : DECISIONS.DEFER;
    reason = why;
  };
  const approval = (why, approver = 'human') => {
    if (decision === DECISIONS.DENY || decision === DECISIONS.APPROVAL_REQUIRED) return;
    decision = DECISIONS.APPROVAL_REQUIRED;
    reason = why;
    requiredApprover = approver;
  };

  if (tenantId !== policy.organizationId) {
    deny(`cross-tenant action rejected: policy belongs to ${policy.organizationId}`);
    record('tenant');
    return finalize();
  }
  record('tenant', 'match');

  const blockingSwitch = switchBlocks(killSwitches, {
    organizationId: policy.organizationId,
    platform: String(action.platform ?? '').toLowerCase(),
    campaignId: action.campaignId
  });
  if (blockingSwitch) {
    deny(`kill switch active (${blockingSwitch.scope}:${blockingSwitch.id ?? 'global'}) — ${blockingSwitch.reason}`);
    return finalize({ checkName: 'kill_switch', result: blockingSwitch.scope });
  }
  record('kill_switch', 'clear');

  const riskLevel = String(action.riskLevel ?? 'medium').toLowerCase();
  if (riskLevel === 'critical') {
    deny('critical-risk actions are never automated');
    record('risk');
    return finalize();
  }
  record('risk', `level=${riskLevel}`);

  const platform = String(action.platform ?? '').trim().toLowerCase();
  if (platform && !policy.allowedPlatforms.includes(platform)) {
    deny(`platform not allowed by policy: ${platform}`);
    return finalize({ checkName: 'platform', result: platform });
  }
  record('platform', platform || 'unspecified');

  const qualityScore = Number(action.qualityScore ?? 0);
  const complianceScore = Number(action.complianceScore ?? 0);
  if (action.class === 'publish' || action.qualityScore != null) {
    if (qualityScore < policy.minimumQualityScore) {
      deny(`quality score ${qualityScore} below floor ${policy.minimumQualityScore}`);
      return finalize({ checkName: 'quality', result: qualityScore });
    }
    if (complianceScore < policy.minimumComplianceScore) {
      deny(`compliance score ${complianceScore} below floor ${policy.minimumComplianceScore}`);
      return finalize({ checkName: 'compliance', result: complianceScore });
    }
  }
  record('scores', `q=${qualityScore}/c=${complianceScore}`);

  const postsToday = counters?.postsToday?.() ?? 0;
  if (postsToday >= policy.maxPostsPerDay) {
    defer(`daily post cap reached (${postsToday}/${policy.maxPostsPerDay}) — deferred to next window`);
  } else if (policy.maxPostsPerPlatformPerDay != null && platform) {
    const perPlatform = counters?.postsTodayForPlatform?.(platform) ?? 0;
    if (perPlatform >= policy.maxPostsPerPlatformPerDay) {
      defer(`per-platform daily cap reached on ${platform}`);
    }
  }
  record('frequency', `posts_today=${postsToday}/${policy.maxPostsPerDay}`);

  const costToday = counters?.aiCostTodayMinorUnits?.() ?? 0;
  if (costToday > policy.maxAiCostPerDayMinorUnits) {
    deny(`daily AI budget exhausted (${costToday} > ${policy.maxAiCostPerDayMinorUnits} minor units)`);
    return finalize({ checkName: 'budget', result: costToday });
  }
  if (policy.maxAiCostPerCampaignMinorUnits != null && action.campaignId) {
    const campaignCost = counters?.campaignAiCostMinorUnits?.(action.campaignId) ?? 0;
    if (campaignCost > policy.maxAiCostPerCampaignMinorUnits) {
      approval('campaign AI budget exceeded — top-up requires human approval');
    }
  }
  record('budget', `today=${costToday}/${policy.maxAiCostPerDayMinorUnits}`);

  if (decision === DECISIONS.ALLOW && riskLevel === 'high') {
    decision = DECISIONS.APPROVAL_REQUIRED;
    reason = 'high-risk action requires specialist approval';
    requiredApprover = 'specialist';
  }
  record('risk_route', riskLevel);

  const isPublishClass = PUBLISH_CLASSES.includes(action.class);
  const isGenerationClass = GENERATION_CLASSES.includes(action.class);

  if (isPublishClass) {
    switch (policy.mode) {
      case 'manual':
        decision = decision === DECISIONS.ALLOW ? DECISIONS.MANUAL_REQUIRED : decision;
        reason = 'manual mode: a human performs publishing actions';
        requiredApprover = 'human';
        break;
      case 'assisted':
      case 'draft_only':
        deny('draft-only automation may generate content but never publish');
        break;
      case 'approval_required':
        approval('publishing requires human approval in approval_required mode');
        break;
      case 'auto_safe':
        if (!policy.preApprovedContentClasses.includes(String(action.contentClass ?? ''))) {
          approval('content class not pre-approved for auto-safe publishing');
        }
        break;
      case 'autonomous':
        if (!policy.allowAutoPublish) {
          approval('autonomous publishing disabled by policy flag');
        }
        break;
      default:
        deny('unknown mode');
    }
  } else if (isGenerationClass) {
    if (['manual'].includes(policy.mode)) {
      decision = decision === DECISIONS.ALLOW ? DECISIONS.MANUAL_REQUIRED : decision;
      reason = 'manual mode: generation produces suggestions only';
    }
  } else if (action.class === 'optimize' && !policy.allowAutoOptimization) {
    approval('optimization actions are not enabled by policy flags');
  }
  record('mode', `${policy.mode}:${decision.toLowerCase()}`);

  record('mode_decision', decision.toLowerCase());

  return finalize();

  function finalize(extraCheck = null) {
    if (extraCheck) checks.push(check(extraCheck.checkName, extraCheck.result));
    const payload = Object.freeze({
      decision,
      reason,
      requiredApprover,
      policyVersion: policy.version,
      decidedAt: now,
      dryRun: policy.dryRun,
      checks: Object.freeze(checks.map((entry) => Object.freeze(entry)))
    });
    if (auditSink) {
      auditSink(Object.freeze({
        occurredAt: now,
        tenantId: policy.organizationId,
        actor: actorId,
        action: 'automation.decision',
        resourceId: String(action.type ?? 'unknown'),
        detail: Object.freeze({
          decision,
          reason,
          policyVersion: policy.version,
          dryRun: policy.dryRun,
          actionType: String(action.type ?? 'unknown'),
          platform: platform || null,
          campaignId: action.campaignId ?? null
        })
      }));
    }
    return payload;
  }
}
