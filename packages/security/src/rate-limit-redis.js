import { createIngressRateLimiter } from './rate-limit-api.js';

const DEFAULT_TTL_BUFFER_MS = 60_000;

function requirePositive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive number`);
  return n;
}

// Atomic token bucket: read state, refill, consume, persist, expire.
// ARGV: capacity, refillPerMilli, nowMs, ttlMs. KEYS[1] = bucket key.
const TOKEN_BUCKET_LUA = `
local cap = tonumber(ARGV[1])
local perMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local st = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = tonumber(st[1])
local last = tonumber(st[2])
if tokens == nil or last == nil then
  tokens = cap
  last = now
end
local elapsed = math.max(0, now - last)
tokens = math.min(cap, tokens + elapsed * perMs)
local allowed = 0
local retryAfter = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retryAfter = math.ceil((1 - tokens) / perMs)
end
redis.call('HMSET', KEYS[1], 'tokens', tostring(tokens), 'last', tostring(now))
redis.call('PEXPIRE', KEYS[1], ttl)
return {allowed, tostring(math.floor(tokens)), retryAfter}
`;

export function createRedisRateLimitStore({
  client = null,
  requestsPerMinute,
  burst,
  keyPrefix = 'zaff:rl',
  clock = () => Date.now()
} = {}) {
  if (client != null && typeof client.eval !== 'function') {
    throw new TypeError('client with eval(script, numKeys, key, ...args) is required');
  }
  const rpm = requirePositive(requestsPerMinute, 'requestsPerMinute');
  const capacity = Math.floor(requirePositive(burst, 'burst'));
  const prefix = String(keyPrefix ?? '').trim();
  if (!prefix) throw new Error('keyPrefix is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  const refillPerMilli = rpm / 60000;
  const ttlMs = Math.ceil(capacity / refillPerMilli) + DEFAULT_TTL_BUFFER_MS;
  let resolvedClient = client;
  let backendKind = client ? 'redis' : 'memory-fallback';
  // Enforcement never disappears: when Redis is unavailable the embedded
  // limiter keeps this instance's budget enforced (documented degradation —
  // cross-instance fairness pauses until Redis returns).
  const fallbackLimiter = createIngressRateLimiter({ requestsPerMinute: rpm, burst: capacity, clock });

  async function resolveClient() {
    if (resolvedClient) {
      backendKind = 'redis';
      return resolvedClient;
    }
    try {
      const mod = await import('ioredis');
      const Redis = mod.default ?? mod;
      if (process.env.REDIS_URL) {
        resolvedClient = new Redis(process.env.REDIS_URL);
        backendKind = 'redis';
        return resolvedClient;
      }
    } catch {
      void 0;
    }
    backendKind = 'memory-fallback';
    return null;
  }

  async function tryAcquire(key) {
    const normalized = String(key ?? '').trim();
    if (!normalized) throw new Error('rate limit key is required');
    const active = await resolveClient();
    if (!active) {
      const outcome = fallbackLimiter.tryAcquire(normalized);
      return Object.freeze({ ...outcome, backend: backendKind });
    }
    try {
      const reply = await active.eval(
        TOKEN_BUCKET_LUA,
        1,
        `${prefix}:${normalized}`,
        capacity,
        refillPerMilli,
        clock(),
        ttlMs
      );
      const allowed = Number(reply?.[0]) === 1;
      const tokensRemaining = Number(reply?.[1]) || 0;
      const retryAfterMs = Number(reply?.[2]) || 0;
      return Object.freeze({ allowed, tokensRemaining, retryAfterMs, capacity, backend: 'redis' });
    } catch {
      const outcome = fallbackLimiter.tryAcquire(normalized);
      return Object.freeze({ ...outcome, backend: 'memory-fallback' });
    }
  }

  return Object.freeze({
    tryAcquire,
    get backend() { return backendKind; },
    keyPrefix: prefix
  });
}
