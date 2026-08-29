import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityStates, createProviderAdapter, createProviderRegistry } from '../packages/adapters/src/provider-registry.js';
import { CanonicalAdapterManifests } from '../packages/adapters/src/capabilities.js';

test('capability states are the canonical five and frozen', () => {
  assert.deepEqual(CapabilityStates, {
    AVAILABLE: 'available',
    APPROVAL_REQUIRED: 'approval_required',
    MANUAL: 'manual',
    UNSUPPORTED: 'unsupported',
    TEMPORARILY_DISABLED: 'temporarily_disabled'
  });
});

test('read capabilities on a configured manifest resolve to available without approval', () => {
  const tiktok = createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok });
  const decision = tiktok.resolve('catalog.read');
  assert.equal(decision.state, 'available');
  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresApproval, false);
});

test('mutating capabilities default to approval_required and stay blocked until approved', () => {
  const tiktok = createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok });
  const blocked = tiktok.resolve('content.publish');
  assert.equal(blocked.state, 'approval_required');
  assert.equal(blocked.allowed, false);
  const approved = tiktok.resolve('content.publish', { approved: true, approvalId: 'apr_123' });
  assert.equal(approved.allowed, true);
  assert.equal(approved.requiresApproval, true);
});

test('approval claims without an approval id are rejected', () => {
  const tiktok = createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok });
  const noId = tiktok.resolve('content.publish', { approved: true });
  assert.equal(noId.allowed, false);
  const noFlag = tiktok.resolve('content.publish', { approvalId: 'apr_123' });
  assert.equal(noFlag.allowed, false);
});

test('unknown capabilities are unsupported and never allowed', () => {
  const tiktok = createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok });
  const decision = tiktok.resolve('browser.automation');
  assert.equal(decision.state, 'unsupported');
  assert.equal(decision.allowed, false);
});

test('manual operations can never be automated, even with approval context', () => {
  const shopee = createProviderAdapter({
    manifest: CanonicalAdapterManifests.shopee,
    capabilities: { 'orders.read': { state: 'manual', reason: 'seller-center-export-only' } }
  });
  const decision = shopee.resolve('orders.read', { approved: true, approvalId: 'apr_9' });
  assert.equal(decision.state, 'manual');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'manual_execution_required');
});

test('temporarily_disabled overrides the manifest default and fails closed', () => {
  const lazada = createProviderAdapter({
    manifest: CanonicalAdapterManifests.lazada,
    capabilities: { 'catalog.read': { state: 'temporarily_disabled', reason: 'provider-outage' } }
  });
  const decision = lazada.resolve('catalog.read');
  assert.equal(decision.state, 'temporarily_disabled');
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'temporarily_disabled');
});

test('unsupported platform adapters are rejected at construction time', () => {
  assert.throws(() => createProviderAdapter({ manifest: createFake() }), /unsupported adapter platform/);
  function createFake() {
    return { platform: 'myspace', capabilities: [], secretMode: 'server-only', supportsIdempotency: false, supportsWebhooks: false };
  }
});

test('registry resolution fails closed for unconfigured providers', () => {
  const registry = createProviderRegistry({
    adapters: [createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok })]
  });
  const decision = registry.resolve('youtube', 'content.publish', { approved: true, approvalId: 'apr_1' });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'adapter_not_configured');
  assert.equal(registry.get('tiktok').platform, 'tiktok');
});

test('registry surfaces every provider state for dashboards', () => {
  const registry = createProviderRegistry({
    adapters: [
      createProviderAdapter({ manifest: CanonicalAdapterManifests.tiktok }),
      createProviderAdapter({
        manifest: CanonicalAdapterManifests.shopee,
        capabilities: { 'orders.read': { state: 'manual', reason: 'export-only' } }
      })
    ]
  });
  const matrix = registry.describe();
  assert.equal(matrix.length, 2);
  const shopee = matrix.find((entry) => entry.platform === 'shopee');
  assert.equal(shopee.capabilities['orders.read'].state, 'manual');
  const tiktok = matrix.find((entry) => entry.platform === 'tiktok');
  assert.equal(tiktok.capabilities['catalog.read'].state, 'available');
});
