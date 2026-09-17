import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyAwareProviderAdapter, createPolicyAwareProviderRegistry } from '../packages/adapters/src/policy-aware-registry.js';
import { createPolicyEntry, createPolicyRegistry, PolicyEffect } from '../packages/adapters/src/policy-registry.js';
import { CapabilityStates } from '../packages/adapters/src/provider-registry.js';

function makeTiktokManifest() {
  return {
    platform: 'tiktok',
    capabilities: ['catalog.read', 'orders.read', 'affiliate.links.write', 'campaigns.write', 'content.publish', 'analytics.read', 'webhooks.receive'],
    secretMode: 'server-only',
    supportsIdempotency: true,
    supportsWebhooks: true,
    restrictions: [],
    requiredDisclosures: [],
    rateLimits: {},
    contentConstraints: {}
  };
}

test('createPolicyAwareProviderAdapter uses policy registry for read capabilities', () => {
  const adapter = createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() });
  const result = adapter.resolve('catalog.read');
  assert.equal(result.allowed, true);
  assert.equal(result.state, CapabilityStates.AVAILABLE);
  assert.equal(result.reason, 'read_capability');
  assert.ok(result.policyVersion);
});

test('createPolicyAwareProviderAdapter requires approval for mutating capabilities', () => {
  const adapter = createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() });
  const result = adapter.resolve('content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.state, CapabilityStates.APPROVAL_REQUIRED);
  assert.equal(result.reason, 'mutating_capability_requires_approval');
  assert.equal(result.requiresApproval, true);
});

test('createPolicyAwareProviderAdapter allows mutating with approval context', () => {
  const adapter = createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() });
  const result = adapter.resolve('content.publish', { approved: true, approvalId: 'apr-123' });
  assert.equal(result.allowed, true);
  assert.equal(result.state, CapabilityStates.APPROVAL_REQUIRED);
  assert.equal(result.reason, 'approved');
  assert.equal(result.approvalId, 'apr-123');
});

test('createPolicyAwareProviderAdapter respects override MANUAL', () => {
  const adapter = createPolicyAwareProviderAdapter({
    manifest: makeTiktokManifest(),
    capabilities: { 'content.publish': { state: 'manual', reason: 'custom reason' } }
  });
  const result = adapter.resolve('content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.state, CapabilityStates.MANUAL);
  assert.equal(result.reason, 'manual_execution_required');
});

test('createPolicyAwareProviderAdapter respects override TEMPORARILY_DISABLED', () => {
  const adapter = createPolicyAwareProviderAdapter({
    manifest: makeTiktokManifest(),
    capabilities: { 'content.publish': { state: 'temporarily_disabled', reason: 'maintenance' } }
  });
  const result = adapter.resolve('content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.state, CapabilityStates.TEMPORARILY_DISABLED);
  assert.equal(result.reason, 'temporarily_disabled');
});

test('createPolicyAwareProviderRegistry resolves via policy', () => {
  const registry = createPolicyAwareProviderRegistry({
    adapters: [createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() })]
  });
  const result = registry.resolve('tiktok', 'catalog.read');
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'read_capability');
});

test('createPolicyAwareProviderRegistry requires approval for mutating', () => {
  const registry = createPolicyAwareProviderRegistry({
    adapters: [createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() })]
  });
  const result = registry.resolve('tiktok', 'content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
});

test('createPolicyAwareProviderRegistry allows mutating with approval', () => {
  const registry = createPolicyAwareProviderRegistry({
    adapters: [createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() })]
  });
  const result = registry.resolve('tiktok', 'content.publish', { approved: true, approvalId: 'apr-456' });
  assert.equal(result.allowed, true);
  assert.equal(result.approvalId, 'apr-456');
});

test('createPolicyAwareProviderRegistry exposes policy registry', () => {
  const registry = createPolicyAwareProviderRegistry({
    adapters: [createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() })]
  });
  const policyRegistry = registry.getPolicyRegistry();
  assert.ok(typeof policyRegistry.evaluate === 'function');
  assert.equal(policyRegistry.getRegistryVersion(), '1.0.0');
});

test('createPolicyAwareProviderAdapter rejects unknown capability via policy', () => {
  const adapter = createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest() });
  const result = adapter.resolve('unknown.capability');
  assert.equal(result.allowed, false);
  assert.equal(result.state, CapabilityStates.UNSUPPORTED);
  assert.equal(result.reason, 'capability_not_declared');
});

test('createPolicyAwareProviderAdapter uses custom policy registry', () => {
  const customPolicy = createPolicyRegistry();
  const entry = createPolicyEntry({
    platform: 'tiktok',
    version: '2.0.0',
    capabilities: ['catalog.read', 'content.publish'],
    restrictions: ['custom restriction'],
    requiredDisclosures: ['#Custom'],
    rateLimits: { defaultRps: 100 },
    contentConstraints: { maxCaptionLength: 500 },
    lastVerifiedAt: '2026-01-01T00:00:00Z',
    approvedBy: 'custom',
    changeReason: 'custom policy'
  });
  customPolicy.register(entry);

  const adapter = createPolicyAwareProviderAdapter({ manifest: makeTiktokManifest(), policyRegistry: customPolicy });
  const result = adapter.resolve('content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.policyVersion, '2.0.0');
});