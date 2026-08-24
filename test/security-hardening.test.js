import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngressRateLimiter } from '../packages/security/src/rate-limit-api.js';
import { createSecurityEventRecorder, SECURITY_EVENT_TYPES } from '../packages/security/src/security-events.js';

const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();

function limiter(overrides = {}) {
  return createIngressRateLimiter({ requestsPerMinute: 60, burst: 3, clock: () => NOW, ...overrides });
}

test('limiter allows bursts up to capacity then throttles with retry-after', () => {
  const bucket = limiter();
  assert.equal(bucket.tryAcquire('go:org-A').allowed, true);
  assert.equal(bucket.tryAcquire('go:org-A').allowed, true);
  assert.equal(bucket.tryAcquire('go:org-A').allowed, true);
  const blocked = bucket.tryAcquire('go:org-A');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0 && blockRetryIsFinite(blocked));
  function blockRetryIsFinite(decision) {
    return Number.isFinite(decision.retryAfterMs);
  }
});

test('buckets are isolated per key so one tenant cannot throttle another', () => {
  const bucket = limiter();
  bucket.tryAcquire('go:org-A');
  bucket.tryAcquire('go:org-A');
  bucket.tryAcquire('go:org-A');
  assert.equal(bucket.tryAcquire('go:org-B').allowed, true);
  assert.equal(bucket.tryAcquire('webhook:org-A').allowed, true);
});

test('tokens refill over time according to the configured rate', () => {
  let now = NOW;
  const bucket = createIngressRateLimiter({ requestsPerMinute: 2, burst: 1, clock: () => now });
  assert.equal(bucket.tryAcquire('k').allowed, true);
  assert.equal(bucket.tryAcquire('k').allowed, false);
  now += 15000;
  assert.equal(bucket.tryAcquire('k').allowed, false, '15s of a 2/min rate is only half a token');
  now += 16000;
  assert.equal(bucket.tryAcquire('k').allowed, true);
});

test('malformed limits are rejected at construction', () => {
  assert.throws(() => createIngressRateLimiter({ requestsPerMinute: 0, burst: 3 }), /requestsPerMinute/i);
  assert.throws(() => createIngressRateLimiter({ requestsPerMinute: 60, burst: 0 }), /burst/i);
});

test('security event recorder accepts canonical types and freezes records', () => {
  const events = [];
  const recorder = createSecurityEventRecorder({ sink: (event) => events.push(event), clock: () => NOW });
  recorder.record({ type: 'RATE_LIMITED', severity: 'LOW', resource: 'go:org-A', reason: 'burst exceeded' });
  assert.equal(events.length, 1);
  assert.ok(Object.isFrozen(events[0]));
  assert.equal(events[0].type, 'RATE_LIMITED');
  assert.ok(SECURITY_EVENT_TYPES.has('WEBHOOK_SIGNATURE_FAILURE'));
  assert.ok(SECURITY_EVENT_TYPES.has('CROSS_TENANT_ACCESS_DENIED'));
});

test('unknown security event types and severities fail closed', () => {
  const recorder = createSecurityEventRecorder({ sink: () => {} });
  assert.throws(() => recorder.record({ type: 'VIBES', severity: 'LOW' }), /unsupported security event type/i);
  assert.throws(() => recorder.record({ type: 'RATE_LIMITED', severity: 'MAXIMUM' }), /unsupported severity/i);
});

test('recorder without a sink still validates and counts', () => {
  const recorder = createSecurityEventRecorder({});
  recorder.record({ type: 'WEBHOOK_SIGNATURE_FAILURE', severity: 'MEDIUM', resource: 'webhooks/shopee' });
  assert.equal(recorder.count('WEBHOOK_SIGNATURE_FAILURE'), 1);
});
