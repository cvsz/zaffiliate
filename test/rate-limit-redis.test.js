import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisRateLimitStore } from '../packages/security/src/rate-limit-redis.js';
import { createIngressRateLimiter } from '../packages/security/src/rate-limit-api.js';
import { buildServer } from '../apps/api/src/server.js';
import { once } from 'node:events';

const NOW = 1_760_000_000_000;
const clock = () => NOW;

function fakeRedis({ replies = [], throwOnEval = false } = {}) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async eval(script, numKeys, key, ...args) {
      calls.push({ script, numKeys, key, args });
      if (throwOnEval) throw new Error('REDIS DOWN');
      const reply = replies[i % replies.length];
      i += 1;
      return reply;
    }
  };
}

test('distributed store evaluates atomic token-bucket lua with sane arguments', async () => {
  const client = fakeRedis({ replies: [[1, '9', 0]] });
  const store = createRedisRateLimitStore({
    client,
    requestsPerMinute: 60,
    burst: 10,
    keyPrefix: 'zaff:test',
    clock
  });
  const outcome = await store.tryAcquire('go:org-A:1.2.3.4');
  assert.equal(outcome.allowed, true);
  assert.equal(outcome.tokensRemaining, 9);
  assert.equal(outcome.backend, 'redis');
  assert.equal(client.calls.length, 1);
  const { script, numKeys, key, args } = client.calls[0];
  assert.match(script, /HMGET/, 'bucket state must be read');
  assert.match(script, /PEXPIRE/, 'bucket must expire');
  assert.equal(numKeys, 1);
  assert.equal(key, 'zaff:test:go:org-A:1.2.3.4');
  const [capacity, perMilli, nowArg] = args;
  assert.equal(Number(capacity), 10);
  assert.ok(Math.abs(Number(perMilli) - 0.001) < 1e-12, '60rpm = 1 token per 1000ms');
  assert.equal(Number(nowArg), NOW);
});

test('denied verdicts carry retryAfterMs from the atomic evaluation', async () => {
  const client = fakeRedis({ replies: [[0, '0', 250]] });
  const store = createRedisRateLimitStore({ client, requestsPerMinute: 60, burst: 1, keyPrefix: 'zaff:test', clock });
  const outcome = await store.tryAcquire('k');
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.retryAfterMs, 250);
  assert.equal(outcome.tokensRemaining, 0);
});

test('redis failure degrades to enforced in-memory limiter instead of failing open', async () => {
  const client = fakeRedis({ throwOnEval: true });
  const store = createRedisRateLimitStore({ client, requestsPerMinute: 60, burst: 2, keyPrefix: 'zaff:test', clock });
  const outcomes = [];
  for (let i = 0; i < 4; i += 1) outcomes.push(await store.tryAcquire('same-key'));
  assert.equal(outcomes.filter((o) => o.allowed && o.backend === 'memory-fallback').length, 2, 'burst honored by fallback');
  const denied = outcomes.find((o) => !o.allowed);
  assert.ok(denied, 'fallback must still deny beyond burst');
  assert.equal(denied.backend, 'memory-fallback');
  assert.ok(denied.retryAfterMs > 0);
});

test('two limiter instances sharing one redis store share one budget (cross-process)', async () => {
  const client = fakeRedis({ replies: [[1, '8', 0], [1, '7', 0], [0, '0', 900], [0, '0', 850]] });
  const mk = () => createRedisRateLimitStore({ client, requestsPerMinute: 60, burst: 2, keyPrefix: 'shared', clock });
  const a = mk();
  const b = mk();
  const first = await a.tryAcquire('tenant-key');
  const second = await b.tryAcquire('tenant-key');
  const thirdA = await a.tryAcquire('tenant-key');
  const thirdB = await b.tryAcquire('tenant-key');
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(thirdA.allowed, false, 'instance A must see budget consumed by instance B');
  assert.equal(thirdB.allowed, false, 'instance B must see budget consumed by instance A');
});

test('server integration: redis-backed limiter produces canonical 429 with retry-after', async (t) => {
  let evals = 0;
  const client = fakeRedis({});
  client.eval = async (...args) => {
    evals += 1;
    return evals <= 2 ? [1, '0', 0] : [0, '0', 1000];
  };
  const limiter = createIngressRateLimiter({
    requestsPerMinute: 600,
    burst: 2,
    clock,
    store: createRedisRateLimitStore({ client, requestsPerMinute: 600, burst: 2, keyPrefix: 'zaff:e2e', clock })
  });
  const runtime = {
    resolveLinkBySlug: () => null,
    recordClick: () => {
      throw new Error('recordClick must not be called for an unknown link');
    }
  };
  const server = buildServer({ env: { APP_ENV: 'development' }, runtime, rateLimiter: limiter });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const codes = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(`${base}/go/some-slug`, { headers: { 'x-tenant-id': 'org-A' }, redirect: 'manual' });
    codes.push(res.status);
    if (res.status === 429) {
      assert.ok(res.headers.get('retry-after'), '429 must carry Retry-After');
      assert.equal((await res.json()).error.code, 'RATE_LIMITED');
    }
  }
  assert.deepEqual(codes.slice(-1), [429], 'third+ request must be limited by the distributed store');
});
