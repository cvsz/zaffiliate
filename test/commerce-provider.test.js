import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommerceProvider, CommerceProviderError, CommerceProviderCapabilities, classifyCommerceError } from '../packages/adapters/src/commerce-provider.js';

test('CommerceProviderCapabilities lists all known capabilities', () => {
  assert.equal(CommerceProviderCapabilities.length, 9);
  assert.ok(CommerceProviderCapabilities.includes('PRODUCT_SEARCH'));
  assert.ok(CommerceProviderCapabilities.includes('PRODUCT_SYNC'));
  assert.ok(CommerceProviderCapabilities.includes('AFFILIATE_LINK'));
});

test('createCommerceProvider validates required inputs', () => {
  assert.throws(() => createCommerceProvider({}), /provider is required/);
  assert.throws(() => createCommerceProvider({ provider: 'shopee' }), /transport function is required/);
});

test('createCommerceProvider classifies errors correctly', () => {
  const rateLimit = classifyCommerceError(429, 'rate_limit', 'too many requests');
  assert.equal(rateLimit.retryable, true);

  const authFail = classifyCommerceError(401, 'unauthorized', 'auth failed');
  assert.equal(authFail.retryable, false);

  const serverErr = classifyCommerceError(500, 'server_error', 'internal error');
  assert.equal(serverErr.retryable, true);

  const validation = classifyCommerceError(400, 'invalid_param', 'bad request');
  assert.equal(validation.retryable, false);
});

test('createCommerceProvider throws CommerceProviderError on non-2xx', async () => {
  const provider = createCommerceProvider({
    provider: 'shopee',
    manifest: { platform: 'shopee', capabilities: ['catalog.read'] },
    transport: async () => ({ status: 400, text: () => JSON.stringify({ code: 'INVALID_PARAM', message: 'bad request' }) })
  });
  try {
    await provider.callApi('http://example.com/api', { method: 'GET' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err instanceof CommerceProviderError, true);
    assert.ok(['VALIDATION', 'PROVIDER_UNAVAILABLE', 'AUTHENTICATION', 'AUTHORIZATION', 'PERMANENT', 'RATE_LIMIT'].includes(err.code));
  }
});

test('createCommerceProvider rate limits by burst', async () => {
  const calls = [];
  const provider = createCommerceProvider({
    provider: 'shopee',
    manifest: { platform: 'shopee', rateLimits: { defaultRps: 100, burst: 3 } },
    transport: async () => { calls.push(Date.now()); return { status: 200, text: () => '{}' }; }
  });
  await provider.callApi('http://example.com/api', { method: 'GET' });
  await provider.callApi('http://example.com/api', { method: 'GET' });
  await provider.callApi('http://example.com/api', { method: 'GET' });
  assert.equal(calls.length, 3);
});
