import { createHash } from 'node:crypto';
import { AdapterPlatforms } from './capabilities.js';

export const POLICY_REGISTRY_VERSION = '1.0.0';

export const PolicyActions = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  PUBLISH: 'publish',
  MESSAGE: 'message',
  WEBHOOK: 'webhook'
});

export const PolicyEffect = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
  REQUIRE_IDEMPOTENCY: 'require_idempotency',
  MANUAL: 'manual'
});

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('version must be semver (major.minor.patch)');
  }
}

export function createPolicyEntry({
  platform,
  version,
  capabilities,
  restrictions = [],
  requiredDisclosures = [],
  rateLimits = {},
  contentConstraints = {},
  lastVerifiedAt = null,
  approvedBy = null,
  changeReason = ''
} = {}) {
  const normalizedPlatform = required(platform, 'platform').toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform)) throw new Error('unsupported adapter platform');

  validateVersion(version);

  const normalizedCapabilities = [...new Set((capabilities || []).map((c) => required(c, 'capability').toLowerCase()))].sort();
  const normalizedRestrictions = [...new Set((restrictions || []).map((r) => String(r).trim()).filter(Boolean))].sort();
  const normalizedDisclosures = [...new Set((requiredDisclosures || []).map((r) => String(r).trim()).filter(Boolean))].sort();

  if (rateLimits != null && typeof rateLimits !== 'object') throw new Error('rateLimits must be an object');
  if (contentConstraints != null && typeof contentConstraints !== 'object') throw new Error('contentConstraints must be an object');

  let verifiedAt = null;
  if (lastVerifiedAt != null) {
    const d = new Date(lastVerifiedAt);
    if (Number.isNaN(d.getTime())) throw new Error('lastVerifiedAt must be a valid timestamp');
    verifiedAt = d.toISOString();
  }

  const entry = Object.freeze({
    platform: normalizedPlatform,
    version,
    capabilities: Object.freeze(normalizedCapabilities),
    restrictions: Object.freeze(normalizedRestrictions),
    requiredDisclosures: Object.freeze(normalizedDisclosures),
    rateLimits: Object.freeze({ ...rateLimits }),
    contentConstraints: Object.freeze({ ...contentConstraints }),
    lastVerifiedAt: verifiedAt,
    approvedBy: approvedBy ? String(approvedBy).trim() : null,
    changeReason: changeReason ? String(changeReason).trim() : '',
    createdAt: new Date().toISOString()
  });

  const content = JSON.stringify(entry);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  return Object.freeze({
    ...entry,
    hash
  });
}

export function createPolicyRegistry({ entries = [] } = {}) {
  const byPlatform = new Map();
  const versions = new Map();
  const history = [];

  for (const entry of entries) {
    register(entry);
  }

  function register(entry) {
    if (!entry || typeof entry !== 'object') throw new TypeError('entry is required');
    if (!entry.platform || !entry.version || !entry.hash) throw new Error('invalid policy entry: missing platform, version, or hash');

    const platform = entry.platform;
    const version = entry.version;

    if (!byPlatform.has(platform)) {
      byPlatform.set(platform, new Map());
    }
    if (byPlatform.get(platform).has(version)) {
      throw new Error(`policy version ${version} already exists for platform ${platform}`);
    }

    byPlatform.get(platform).set(version, entry);

    if (!versions.has(version)) {
      versions.set(version, new Set());
    }
    versions.get(version).add(platform);

    history.push(Object.freeze({
      action: 'register',
      platform,
      version,
      hash: entry.hash,
      timestamp: new Date().toISOString()
    }));
  }

  function getLatest(platform) {
    const normalized = String(platform ?? '').trim().toLowerCase();
    const platformVersions = byPlatform.get(normalized);
    if (!platformVersions || platformVersions.size === 0) return null;

    const latest = [...platformVersions.keys()].sort((a, b) => compareVersions(b, a))[0];
    return platformVersions.get(latest) ?? null;
  }

  function getVersion(platform, version) {
    const normalized = String(platform ?? '').trim().toLowerCase();
    const platformVersions = byPlatform.get(normalized);
    if (!platformVersions) return null;
    return platformVersions.get(version) ?? null;
  }

  function getAllVersions(platform) {
    const normalized = String(platform ?? '').trim().toLowerCase();
    const platformVersions = byPlatform.get(normalized);
    if (!platformVersions) return [];
    return [...platformVersions.values()].sort((a, b) => compareVersions(b.version, a.version));
  }

  function compareVersions(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
  }

  function getRegistryVersion() {
    return POLICY_REGISTRY_VERSION;
  }

  function getHistory() {
    return Object.freeze([...history]);
  }

  function evaluate(platform, capability, context = {}) {
    const latest = getLatest(platform);
    if (!latest) {
      return Object.freeze({
        platform,
        capability,
        allowed: false,
        effect: PolicyEffect.DENY,
        reason: 'platform_not_configured',
        policyVersion: null
      });
    }

    const hasCapability = latest.capabilities.includes(String(capability ?? '').trim().toLowerCase());
    if (!hasCapability) {
      return Object.freeze({
        platform,
        capability,
        allowed: false,
        effect: PolicyEffect.DENY,
        reason: 'capability_not_declared',
        policyVersion: latest.version
      });
    }

    const isMutating = capability.endsWith('.write') || capability === 'content.publish' || capability === 'messages.send';
    const isRead = capability.endsWith('.read') || capability === 'webhooks.receive';

    if (isRead) {
      return Object.freeze({
        platform,
        capability,
        allowed: true,
        effect: PolicyEffect.ALLOW,
        reason: 'read_capability',
        policyVersion: latest.version
      });
    }

    if (isMutating) {
      const requiresApproval = context.approved === true && context.approvalId;
      if (!requiresApproval) {
        return Object.freeze({
          platform,
          capability,
          allowed: false,
          effect: PolicyEffect.REQUIRE_APPROVAL,
          reason: 'mutating_capability_requires_approval',
          policyVersion: latest.version
        });
      }
      const requiresIdempotency = latest.capabilities.some(c => c === capability) && context.idempotencyKey;
      return Object.freeze({
        platform,
        capability,
        allowed: true,
        effect: requiresIdempotency ? PolicyEffect.REQUIRE_IDEMPOTENCY : PolicyEffect.ALLOW,
        reason: 'approved',
        policyVersion: latest.version,
        approvalId: context.approvalId
      });
    }

    return Object.freeze({
      platform,
      capability,
      allowed: true,
      effect: PolicyEffect.ALLOW,
      reason: 'default_allow',
      policyVersion: latest.version
    });
  }

  return Object.freeze({
    register,
    getLatest,
    getVersion,
    getAllVersions,
    getRegistryVersion,
    getHistory,
    evaluate
  });
}

export function buildCanonicalPolicyRegistry() {
  const entries = [];

  const platforms = [
    {
      platform: 'tiktok',
      version: '1.0.0',
      capabilities: ['catalog.read', 'orders.read', 'affiliate.links.write', 'campaigns.write', 'content.publish', 'analytics.read', 'webhooks.receive'],
      restrictions: ['affiliate product must be enabled on Shop Partner app'],
      requiredDisclosures: ['#Sponsored'],
      rateLimits: { defaultRps: 5, burst: 20 },
      contentConstraints: { maxCaptionLength: 2200 },
      lastVerifiedAt: '2026-08-30T00:00:00Z',
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'shopee',
      version: '1.0.0',
      capabilities: ['catalog.read', 'orders.read', 'affiliate.links.write', 'analytics.read', 'webhooks.receive'],
      restrictions: ['sandbox credentials required'],
      requiredDisclosures: ['#Affiliate'],
      rateLimits: { defaultRps: 5 },
      contentConstraints: {},
      lastVerifiedAt: '2026-08-24T00:00:00Z',
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'lazada',
      version: '1.0.0',
      capabilities: ['catalog.read', 'orders.read', 'affiliate.links.write', 'analytics.read', 'webhooks.receive'],
      restrictions: [],
      requiredDisclosures: [],
      rateLimits: { defaultRps: 5 },
      contentConstraints: {},
      lastVerifiedAt: '2026-08-24T00:00:00Z',
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'facebook',
      version: '1.0.0',
      capabilities: ['content.publish', 'analytics.read', 'webhooks.receive'],
      restrictions: ['manual publishing boundary only'],
      requiredDisclosures: ['#Ad'],
      rateLimits: {},
      contentConstraints: { maxVideoSeconds: 600 },
      lastVerifiedAt: null,
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'instagram',
      version: '1.0.0',
      capabilities: ['content.publish', 'analytics.read', 'webhooks.receive'],
      restrictions: ['manual boundary'],
      requiredDisclosures: ['#Ad'],
      rateLimits: {},
      contentConstraints: {},
      lastVerifiedAt: null,
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'youtube',
      version: '1.0.0',
      capabilities: ['content.publish', 'analytics.read', 'webhooks.receive'],
      restrictions: ['manual boundary'],
      requiredDisclosures: ['#Ad'],
      rateLimits: {},
      contentConstraints: {},
      lastVerifiedAt: null,
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    },
    {
      platform: 'line',
      version: '1.0.0',
      capabilities: ['messages.send', 'analytics.read', 'webhooks.receive'],
      restrictions: ['consent required'],
      requiredDisclosures: [],
      rateLimits: {},
      contentConstraints: {},
      lastVerifiedAt: null,
      approvedBy: 'platform-team',
      changeReason: 'Initial canonical manifest'
    }
  ];

  for (const p of platforms) {
    entries.push(createPolicyEntry(p));
  }

  return createPolicyRegistry({ entries });
}