import { AdapterPlatforms } from './capabilities.js';

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

export function createProviderAdapter({ manifest, capabilities }) {
  const validated = requireManifest(manifest);
  const platform = validated.platform;
  const overrides = normalizeOverrides(capabilities);

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
    const override = overrides.get(normalized);
    const declared = validated.capabilities.includes(normalized);
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
      return decideApproval(normalized, approvalContext, override.reason);
    }
    if (!declared) {
      return frozenDecision({ platform, capability: normalized, state: CapabilityStates.UNSUPPORTED, allowed: false, requiresApproval: false, reason: 'capability_not_supported' });
    }
    return defaultStateFor(normalized) === CapabilityStates.AVAILABLE
      ? frozenDecision({ platform, capability: normalized, state: CapabilityStates.AVAILABLE, allowed: true, requiresApproval: false, reason: 'read_only_capability' })
      : decideApproval(normalized, approvalContext, null);
  }

  function decideApproval(capability, approvalContext = {}, reasonOverride) {
    const approved = approvalContext?.approved === true;
    const approvalId = String(approvalContext?.approvalId ?? '').trim();
    if (!approved || !approvalId) {
      return frozenDecision({
        platform,
        capability,
        state: CapabilityStates.APPROVAL_REQUIRED,
        allowed: false,
        requiresApproval: true,
        reason: reasonOverride || 'approval_required',
        missingApproval: !approved ? 'approved_flag' : 'approval_id'
      });
    }
    return frozenDecision({
      platform,
      capability,
      state: CapabilityStates.APPROVAL_REQUIRED,
      allowed: true,
      requiresApproval: true,
      reason: 'approved',
      approvalId
    });
  }

  return Object.freeze({
    platform,
    manifest: Object.freeze(validated),
    resolve,
    describe
  });
}

export function createProviderRegistry({ adapters }) {
  if (!Array.isArray(adapters)) throw new TypeError('adapters must be an array');
  const byPlatform = new Map();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.resolve !== 'function' || !adapter.platform) {
      throw new TypeError('each adapter must be created by createProviderAdapter');
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

  return Object.freeze({ get, resolve, describe });
}
