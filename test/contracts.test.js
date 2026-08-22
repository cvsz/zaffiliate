import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAffiliateLink, requireTenantContext } from '../packages/contracts/src/index.js';

test('tenant context rejects missing tenant', () => {
  assert.throws(() => requireTenantContext({ actorId: 'user-1' }), /tenantId/);
});

test('tenant context requires actor', () => {
  assert.throws(() => requireTenantContext({ tenantId: 'tenant-1' }), /actorId/);
});

test('affiliate link accepts supported HTTPS platform', () => {
  const value = normalizeAffiliateLink({ platform: 'tiktok', url: 'https://shop.example/item', externalProductId: 'p1', subId: 'campaign-a' });
  assert.equal(value.platform, 'tiktok');
  assert.equal(value.externalProductId, 'p1');
});

test('affiliate link rejects insecure URL', () => {
  assert.throws(() => normalizeAffiliateLink({ platform: 'tiktok', url: 'http://shop.example/item' }), /HTTPS/);
});

test('affiliate link rejects unknown platform', () => {
  assert.throws(() => normalizeAffiliateLink({ platform: 'unknown', url: 'https://example.com' }), /unsupported/);
});
