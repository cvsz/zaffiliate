import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyEntry, createPolicyRegistry, buildCanonicalPolicyRegistry, POLICY_REGISTRY_VERSION, PolicyEffect } from '../packages/adapters/src/policy-registry.js';

test('createPolicyEntry builds frozen entry with hash', () => {
  const entry = createPolicyEntry({
    platform: 'tiktok',
    version: '1.0.0',
    capabilities: ['catalog.read', 'content.publish'],
    restrictions: ['test restriction'],
    requiredDisclosures: ['#Sponsored'],
    rateLimits: { defaultRps: 10 },
    contentConstraints: { maxCaptionLength: 100 },
    lastVerifiedAt: '2026-01-01T00:00:00Z',
    approvedBy: 'test-user',
    changeReason: 'test entry'
  });
  assert.equal(entry.platform, 'tiktok');
  assert.equal(entry.version, '1.0.0');
  assert.ok(entry.hash && entry.hash.length === 16);
  assert.ok(Array.isArray(entry.capabilities));
  assert.ok(Array.isArray(entry.restrictions));
  assert.ok(Object.isFrozen(entry));
});

test('createPolicyEntry rejects invalid platform', () => {
  assert.throws(() => createPolicyEntry({ platform: 'invalid', version: '1.0.0', capabilities: [] }), /unsupported adapter platform/);
});

test('createPolicyEntry rejects invalid version format', () => {
  assert.throws(() => createPolicyEntry({ platform: 'tiktok', version: '1.0', capabilities: [] }), /semver/);
  assert.throws(() => createPolicyEntry({ platform: 'tiktok', version: 'v1.0.0', capabilities: [] }), /semver/);
});

test('createPolicyEntry normalizes and deduplicates arrays', () => {
  const entry = createPolicyEntry({
    platform: 'shopee',
    version: '1.0.0',
    capabilities: ['CATALOG.READ', 'catalog.read', '  content.publish  '],
    restrictions: ['a', 'a', 'b'],
    requiredDisclosures: ['#A', '#A']
  });
  assert.deepEqual(entry.capabilities, ['catalog.read', 'content.publish']);
  assert.deepEqual(entry.restrictions, ['a', 'b']);
  assert.deepEqual(entry.requiredDisclosures, ['#A']);
});

test('createPolicyRegistry registers and retrieves entries', () => {
  const e1 = createPolicyEntry({ platform: 'tiktok', version: '1.0.0', capabilities: ['catalog.read'] });
  const e2 = createPolicyEntry({ platform: 'tiktok', version: '1.1.0', capabilities: ['catalog.read', 'content.publish'] });
  const registry = createPolicyRegistry({ entries: [e1, e2] });

  const latest = registry.getLatest('tiktok');
  assert.equal(latest.version, '1.1.0');

  const v1 = registry.getVersion('tiktok', '1.0.0');
  assert.equal(v1.version, '1.0.0');

  const all = registry.getAllVersions('tiktok');
  assert.equal(all.length, 2);
  assert.equal(all[0].version, '1.1.0');
  assert.equal(all[1].version, '1.0.0');
});

test('createPolicyRegistry rejects duplicate version', () => {
  const e1 = createPolicyEntry({ platform: 'tiktok', version: '1.0.0', capabilities: [] });
  const e2 = createPolicyEntry({ platform: 'tiktok', version: '1.0.0', capabilities: [] });
  assert.throws(() => createPolicyRegistry({ entries: [e1, e2] }), /already exists/);
});

test('createPolicyRegistry evaluates read capabilities as ALLOW', () => {
  const registry = buildCanonicalPolicyRegistry();
  const result = registry.evaluate('tiktok', 'catalog.read');
  assert.equal(result.allowed, true);
  assert.equal(result.effect, PolicyEffect.ALLOW);
  assert.equal(result.reason, 'read_capability');
});

test('createPolicyRegistry evaluates unknown capability as DENY', () => {
  const registry = buildCanonicalPolicyRegistry();
  const result = registry.evaluate('tiktok', 'unknown.capability');
  assert.equal(result.allowed, false);
  assert.equal(result.effect, PolicyEffect.DENY);
  assert.equal(result.reason, 'capability_not_declared');
});

test('createPolicyRegistry evaluates mutating capability without approval as REQUIRE_APPROVAL', () => {
  const registry = buildCanonicalPolicyRegistry();
  const result = registry.evaluate('tiktok', 'content.publish');
  assert.equal(result.allowed, false);
  assert.equal(result.effect, PolicyEffect.REQUIRE_APPROVAL);
});

test('createPolicyRegistry evaluates mutating capability with approval as ALLOW', () => {
  const registry = buildCanonicalPolicyRegistry();
  const result = registry.evaluate('tiktok', 'content.publish', { approved: true, approvalId: 'apr-123' });
  assert.equal(result.allowed, true);
  assert.equal(result.effect, PolicyEffect.ALLOW);
  assert.equal(result.approvalId, 'apr-123');
});

test('createPolicyRegistry evaluates unconfigured platform as DENY', () => {
  const registry = createPolicyRegistry();
  const result = registry.evaluate('unknown', 'catalog.read');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'platform_not_configured');
});

test('buildCanonicalPolicyRegistry has all 7 platforms', () => {
  const registry = buildCanonicalPolicyRegistry();
  const platforms = ['tiktok', 'shopee', 'lazada', 'facebook', 'instagram', 'youtube', 'line'];
  for (const p of platforms) {
    const latest = registry.getLatest(p);
    assert.ok(latest, `platform ${p} missing`);
    assert.equal(latest.version, '1.0.0');
  }
});

test('policy registry tracks history', () => {
  const e1 = createPolicyEntry({ platform: 'tiktok', version: '1.0.0', capabilities: [] });
  const registry = createPolicyRegistry({ entries: [e1] });
  const history = registry.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'register');
  assert.equal(history[0].platform, 'tiktok');
});

test('policy registry version constant exposed', () => {
  assert.equal(typeof POLICY_REGISTRY_VERSION, 'string');
  assert.match(POLICY_REGISTRY_VERSION, /^\d+\.\d+\.\d+$/);
});