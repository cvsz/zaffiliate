export function createIngressRateLimiter({ requestsPerMinute, burst, clock = () => Date.now() } = {}) {
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

  function tryAcquire(key) {
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

  return Object.freeze({ tryAcquire });
}
