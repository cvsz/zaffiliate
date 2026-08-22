import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterPlatforms, CanonicalAdapterManifests, createAdapterManifest, classifyAdapterOperation, normalizeAdapterError } from '../packages/adapters/src/capabilities.js';

test('canonical manifests exist for all requested platforms', () => {
  assert.deepEqual(Object.keys(CanonicalAdapterManifests).sort(), [...AdapterPlatforms].sort());
  for (const manifest of Object.values(CanonicalAdapterManifests)) assert.equal(manifest.secretMode, 'server-only');
});

test('mutating adapter operations require approval and idempotency when supported', () => {
  const tiktok = CanonicalAdapterManifests.tiktok;
  assert.deepEqual(classifyAdapterOperation({ manifest: tiktok, capability: 'catalog.read' }), {
    allowed: true, reason: 'capability_supported', mutating: false, requiresApproval: false, requiresIdempotency: false
  });
  assert.deepEqual(classifyAdapterOperation({ manifest: tiktok, capability: 'content.publish' }), {
    allowed: true, reason: 'capability_supported', mutating: true, requiresApproval: true, requiresIdempotency: true
  });
});

test('unsupported capabilities fail closed', () => {
  const line = CanonicalAdapterManifests.line;
  assert.equal(classifyAdapterOperation({ manifest: line, capability: 'orders.read' }).allowed, false);
  assert.throws(() => createAdapterManifest({ platform: 'unknown', capabilities: [] }), /unsupported adapter platform/);
  assert.throws(() => createAdapterManifest({ platform: 'line', capabilities: ['root.shell'] }), /unsupported adapter capability/);
});

test('adapter errors normalize retryability', () => {
  assert.equal(normalizeAdapterError({ platform: 'shopee', status: 429 }).retryable, true);
  assert.equal(normalizeAdapterError({ platform: 'lazada', status: 400 }).retryable, false);
});
