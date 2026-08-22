import { AdapterPlatforms, normalizeAdapterError } from './capabilities.js';

export const ProviderErrorCodePolicy = Object.freeze({
  shopee: Object.freeze({
    'error_param': Object.freeze({ retryable: false, category: 'invalid_request' }),
    'error_auth': Object.freeze({ retryable: false, category: 'auth' }),
    'error_sc_disabled': Object.freeze({ retryable: false, category: 'auth' }),
    'error_permission': Object.freeze({ retryable: false, category: 'permission_denied' }),
    '40300011': Object.freeze({ retryable: false, category: 'permission_denied' }),
    'error_target_user_not_exist': Object.freeze({ retryable: false, category: 'not_found' }),
    'error_ratelimit': Object.freeze({ retryable: true, category: 'rate_limit' }),
    '45001004': Object.freeze({ retryable: true, category: 'rate_limit' }),
    'error_network': Object.freeze({ retryable: true, category: 'transient' }),
    'error_server': Object.freeze({ retryable: true, category: 'server_error' })
  }),
  lazada: Object.freeze({
    '0': Object.freeze({ retryable: false, category: 'success' }),
    '7': Object.freeze({ retryable: true, category: 'rate_limit' }),
    '8': Object.freeze({ retryable: true, category: 'server_error' }),
    '12': Object.freeze({ retryable: false, category: 'permission_denied' }),
    '13': Object.freeze({ retryable: false, category: 'session_expired' }),
    '14': Object.freeze({ retryable: false, category: 'invalid_request' }),
    '15': Object.freeze({ retryable: false, category: 'clock_skew' }),
    '16': Object.freeze({ retryable: false, category: 'missing_session' }),
    '25': Object.freeze({ retryable: false, category: 'signature_mismatch' }),
    '29': Object.freeze({ retryable: false, category: 'forbidden_api' })
  })
});

export function normalizeProviderError({ platform, status = 0, code = null, message = 'adapter request failed', requestId = null } = {}) {
  const normalizedPlatform = String(platform ?? '').trim().toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform)) throw new Error('unsupported adapter platform');
  const base = normalizeAdapterError({ platform: normalizedPlatform, status, code, message, requestId });
  const policyEntry = ProviderErrorCodePolicy[normalizedPlatform]?.[base.code] ?? null;
  const retryable = policyEntry ? policyEntry.retryable : base.retryable;
  const transientHttp = base.httpStatus === 408 || base.httpStatus === 429 || base.httpStatus >= 500;
  const category = policyEntry ? policyEntry.category : transientHttp ? 'transient_http' : 'http_failure';
  return Object.freeze({
    platform: base.platform,
    code: base.code,
    message: base.message,
    requestId: base.requestId,
    httpStatus: base.httpStatus,
    retryable,
    category
  });
}

export function createRateLimitPolicy({ platform, requestsPerMinute, burst } = {}) {
  const normalizedPlatform = String(platform ?? '').trim().toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform)) throw new Error('unsupported rate limit platform');
  const rpm = Number(requestsPerMinute);
  if (!Number.isFinite(rpm) || rpm <= 0) throw new Error('requestsPerMinute must be a positive number');
  const capacity = Number(burst);
  if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('burst must be a positive integer');

  const refillPerMs = rpm / 60000;
  let tokens = capacity;
  let lastRefillMs = Date.now();

  function refill(now = Date.now()) {
    const elapsed = Math.max(0, now - lastRefillMs);
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
      lastRefillMs = now;
    }
  }

  function tryAcquire(n = 1) {
    const count = Number(n);
    if (!Number.isInteger(count) || count <= 0) throw new Error('n must be a positive integer');
    refill();
    if (count > capacity) {
      return Object.freeze({ allowed: false, retryAfterMs: null, tokensRemaining: Math.floor(tokens), capacity });
    }
    if (tokens >= count) {
      tokens -= count;
      return Object.freeze({ allowed: true, retryAfterMs: 0, tokensRemaining: Math.floor(tokens), capacity });
    }
    const deficit = count - tokens;
    return Object.freeze({
      allowed: false,
      retryAfterMs: Math.ceil(deficit / refillPerMs),
      tokensRemaining: Math.floor(tokens),
      capacity
    });
  }

  async function acquire(n = 1, { maxWaitMs = 30000 } = {}) {
    const count = Number(n);
    if (!Number.isInteger(count) || count <= 0) throw new Error('n must be a positive integer');
    if (count > capacity) throw new Error('requested amount exceeds bucket capacity');
    const waitBudget = Number(maxWaitMs);
    if (!Number.isFinite(waitBudget) || waitBudget < 0) throw new Error('maxWaitMs must be a non-negative number');
    let waited = 0;
    for (;;) {
      const decision = tryAcquire(count);
      if (decision.allowed) return decision;
      if (waited + decision.retryAfterMs > waitBudget) {
        const error = new Error('rate limit acquisition window exceeded');
        error.name = 'RateLimitTimeoutError';
        error.retryAfterMs = decision.retryAfterMs;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, decision.retryAfterMs));
      waited += decision.retryAfterMs;
    }
  }

  function snapshot() {
    refill();
    return Object.freeze({
      platform: normalizedPlatform,
      requestsPerMinute: rpm,
      burst: capacity,
      tokensRemaining: Math.floor(tokens)
    });
  }

  return Object.freeze({
    platform: normalizedPlatform,
    requestsPerMinute: rpm,
    burst: capacity,
    tryAcquire,
    acquire,
    snapshot
  });
}
