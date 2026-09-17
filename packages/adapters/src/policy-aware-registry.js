import { AdapterPlatforms } from './capabilities.js';
import { createPolicyRegistry, buildCanonicalPolicyRegistry, PolicyEffect } from './policy-registry.js';

export const CapabilityStates = Object.freeze({
  AVAILABLE: 'available',
  APPROVAL_REQUIRED: 'approval_required',
  MANUAL: 'manual',
  UNSUPPORTED: 'unsupported',
  TEMPORARILY_DISABLED: 'temporarily_disabled'
});

const READ_SUFFIX = '.read';

function isReadOnly(capability) {
  return capability.endsWith(READ_SUFFIX) || capability === 'webhooks.receive';
}

function defaultStateFor(capability) {
  return isReadOnly(capability) ? CapabilityStates.AVAILABLE : CapabilityStates.APPROVAL_REQUIRED;
}

function requireManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('manifest is required');
  const platform = String(manifest.platform ?? '').trim().toLowerCase();
  if (!AdapterPlatforms.includes(platform)) throw new Error('unsupported adapter platform');
  if (manifest.secretMode !== 'server-only') throw new Error('adapter secrets must remain server-only');
  if (!Array.isArray(manifest.capabilities)) throw new TypeError('manifest capabilities must be an array');
  return manifest;
}

function normalizeOverrides(capabilities) {
  const overrides = new Map();
  for (const [capability, entry] of Object.entries(capabilities || {})) {
    const normalized = String(capability).trim();
    if (!normalized) throw new Error('capability is required');
    const state = String(entry?.state ?? '').trim();
    if (!Object.values(CapabilityStates).includes(state)) {
      throw new Error(`unsupported capability state: ${state || '(empty)'}`);
    }
    overrides.set(normalized, Object.freeze({
      state,
      reason: entry.reason == null ? null : String(entry.reason)
    }));
  }
  return overrides;
}

function frozenDecision(decision) {
  return Object.freeze(decision);
}

function mapPolicyEffectToState(effect, capability) {
  switch (effect) {
    case PolicyEffect.ALLOW:
      return defaultStateFor(capability);
    case PolicyEffect.DENY:
      return CapabilityStates.UNSUPPORTED;
    case PolicyEffect.REQUIRE_APPROVAL:
      return CapabilityStates.APPROVAL_REQUIRED;
    case PolicyEffect.REQUIRE_IDEMPOTENCY:
      return CapabilityStates.APPROVAL_REQUIRED;
    case PolicyEffect.MANUAL:
      return CapabilityStates.MANUAL;
    default:
      return CapabilityStates.UNSUPPORTED;
  }
}

export function createPolicyAwareProviderAdapter({ manifest, capabilities, policyRegistry } = {}) {
  const validated = requireManifest(manifest);
  const platform = validated.platform;
  const overrides = normalizeOverrides(capabilities);
  const policy = policyRegistry ?? buildCanonicalPolicyRegistry();

  function describe() {
    const resolved = {};
    for (const capability of validated.capabilities) {
      resolved[capability] = resolve(capability);
    }
    for (const [capability] of overrides) {
      if (!resolved[capability]) resolved[capability] = resolve(capability);
    }
    return Object.freeze({ platform, capabilities: Object.freeze(resolved) });
  }

  function resolve(capability, approvalContext = {}) {
    const normalized = String(capability ?? '').trim();
    if (!normalized) {
      return frozenDecision({ platform, capability: normalized, state: CapabilityStates.UNSUPPORTED, allowed: false, requiresApproval: false, reason: 'capability_not_supported' });
    }

    const policyResult = policy.evaluate(platform, normalized, approvalContext);
    const state = mapPolicyEffectToState(policyResult.effect, normalized);
    const allowed = policyResult.allowed;
    const requiresApproval = policyResult.effect === PolicyEffect.REQUIRE_APPROVAL || policyResult.effect === PolicyEffect.REQUIRE_IDEMPOTENCY;

    const override = overrides.get(normalized);
    if (override) {
      if (override.state === CapabilityStates.MANUAL) {
        return frozenDecision({ platform, capability: normalized, state: override.state, allowed: false, requiresApproval: false, reason: 'manual_execution_required' });
      }
      if (override.state === CapabilityStates.TEMPORARILY_DISABLED) {
        return frozenDecision({ platform, capability: normalized, state: override.state, allowed: false, requiresApproval: false, reason: 'temporarily_disabled' });
      }
      if (override.state === CapabilityStates.UNSUPPORTED) {
        return frozenDecision({ platform, capability: normalized, state: override.state, allowed: false, requiresApproval: false, reason: 'capability_not_supported' });
      }
      if (override.state === CapabilityStates.AVAILABLE) {
        return frozenDecision({ platform, capability: normalized, state: override.state, allowed: true, requiresApproval: false, reason: 'explicitly_available' });
      }
    }

    return frozenDecision({
      platform,
      capability: normalized,
      state,
      allowed,
      requiresApproval,
      reason: policyResult.reason,
      approvalId: policyResult.approvalId ?? null,
      policyVersion: policyResult.policyVersion
    });
  }

  return Object.freeze({
    platform,
    manifest: Object.freeze(validated),
    resolve,
    describe
  });
}

export function createPolicyAwareProviderRegistry({ adapters, policyRegistry } = {}) {
  const registry = policyRegistry ?? buildCanonicalPolicyRegistry();

  if (!Array.isArray(adapters)) throw new TypeError('adapters must be an array');
  const byPlatform = new Map();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.resolve !== 'function' || !adapter.platform) {
      throw new TypeError('each adapter must be created by createPolicyAwareProviderAdapter');
    }
    byPlatform.set(adapter.platform, adapter);
  }

  function get(platform) {
    return byPlatform.get(String(platform ?? '').trim().toLowerCase()) ?? null;
  }

  function resolve(platform, capability, approvalContext) {
    const adapter = get(platform);
    if (!adapter) {
      return frozenDecision({
        platform: String(platform ?? '').trim().toLowerCase(),
        capability: String(capability ?? '').trim(),
        state: CapabilityStates.UNSUPPORTED,
        allowed: false,
        requiresApproval: false,
        reason: 'adapter_not_configured'
      });
    }
    return adapter.resolve(capability, approvalContext);
  }

  function describe() {
    return Object.freeze([...byPlatform.values()].map((adapter) => adapter.describe()));
  }

  function getPolicyRegistry() {
    return registry;
  }

  return Object.freeze({ get, resolve, describe, getPolicyRegistry });
}