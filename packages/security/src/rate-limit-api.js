export function createIngressRateLimiter({ requestsPerMinute, burst, clock = () => Date.now(), store = null } = {}) {
  const rpm = Number(requestsPerMinute);
  const capacity = Number(burst);
  if (!Number.isFinite(rpm) || rpm <= 0) throw new Error('requestsPerMinute must be a positive number');
  if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('burst must be a positive integer');

  const refillPerMs = rpm / 60000;
  const buckets = new Map();

  function bucketFor(key) {
    const normalized = String(key ?? '').trim();
    if (!normalized) throw new Error('rate limit key is required');
    let bucket = buckets.get(normalized);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillMs: clock() };
      buckets.set(normalized, bucket);
    }
    return bucket;
  }

  function refill(bucket) {
    const now = clock();
    const elapsed = Math.max(0, now - bucket.lastRefillMs);
    if (elapsed > 0) {
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
      bucket.lastRefillMs = now;
    }
  }

  function tryAcquireLocal(rawKey) {
    const key = String(rawKey ?? '').trim();
    const bucket = bucketFor(key);
    refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return Object.freeze({ allowed: true, retryAfterMs: 0, tokensRemaining: Math.floor(bucket.tokens), capacity });
    }
    const deficit = 1 - bucket.tokens;
    return Object.freeze({
      allowed: false,
      retryAfterMs: Math.ceil(deficit / refillPerMs),
      tokensRemaining: 0,
      capacity
    });
  }

  if (store == null) {
    return Object.freeze({ tryAcquire: tryAcquireLocal });
  }
  if (typeof store.tryAcquire !== 'function') throw new TypeError('store with tryAcquire is required');
  return Object.freeze({
    async tryAcquire(key) {
      const normalized = String(key ?? '').trim();
      const outcome = await store.tryAcquire(normalized);
      if (outcome == null || typeof outcome.allowed !== 'boolean') {
        // Never fail open: an unusable store answer falls back to local enforcement.
        return tryAcquireLocal(normalized);
      }
      return outcome;
    }
  });
}
