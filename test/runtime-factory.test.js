import test from 'node:test';
import assert from 'node:assert/strict';
import { affiliateRuntimeBackend, createAffiliateRuntimeForEnv } from '../apps/api/src/runtime-factory.js';

test('runtime backend defaults to memory outside production', () => {
  assert.equal(affiliateRuntimeBackend({ NODE_ENV: 'test' }), 'memory');
  assert.equal(affiliateRuntimeBackend({ APP_ENV: 'development' }), 'memory');
});

test('runtime backend defaults to postgres in production', () => {
  assert.equal(affiliateRuntimeBackend({ NODE_ENV: 'production' }), 'postgres');
  assert.equal(affiliateRuntimeBackend({ APP_ENV: 'production' }), 'postgres');
});

test('explicit backend overrides environment and invalid values fail closed', () => {
  assert.equal(affiliateRuntimeBackend({ NODE_ENV: 'production', AFFILIATE_RUNTIME_BACKEND: 'memory' }), 'memory');
  assert.equal(affiliateRuntimeBackend({ NODE_ENV: 'test', AFFILIATE_RUNTIME_BACKEND: 'postgres' }), 'postgres');
  assert.throws(() => affiliateRuntimeBackend({ AFFILIATE_RUNTIME_BACKEND: 'sqlite' }), /unsupported AFFILIATE_RUNTIME_BACKEND/i);
});

test('production postgres backend requires DATABASE_URL before serving', () => {
  assert.throws(
    () => createAffiliateRuntimeForEnv({ env: { NODE_ENV: 'production' } }),
    (error) => error?.code === 'AFFILIATE_DATABASE_REQUIRED'
  );
});

test('memory backend preserves existing synchronous affiliate runtime contract', () => {
  const runtime = createAffiliateRuntimeForEnv({ env: { NODE_ENV: 'test' }, clock: () => new Date('2026-08-30T00:00:00Z').getTime() });
  const product = runtime.registerProduct('tenant-A', { platform: 'tiktok', externalProductId: 'p-1', title: 'Test' });
  assert.match(product.productId, /^prod_/);
});

test('postgres backend constructs lazy repository without opening a connection', () => {
  const runtime = createAffiliateRuntimeForEnv({ env: { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/test' } });
  assert.equal(typeof runtime.registerProduct, 'function');
  assert.equal(typeof runtime.claimOutbox, 'function');
});
