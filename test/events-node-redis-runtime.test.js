import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectNodeRedisCompat,
  createDurableStreamConsumer,
  createStreamPublisher
} from '../packages/events/src/redis-streams.js';

function rawNodeRedis() {
  const commands = [];
  const listeners = [];
  let connected = 0;
  let quit = 0;
  let attempts = 0;
  const rawEntry = ['1-0', ['tenantId', 'org-A', 'type', 'conversion.recorded', 'eventId', 'evt-node-redis', 'payload', '{"orderRef":"o1"}']];
  return {
    commands,
    listeners,
    get connected() { return connected; },
    get quitCalls() { return quit; },
    isOpen: true,
    on(event, listener) { listeners.push({ event, listener }); },
    async connect() { connected += 1; },
    async quit() { quit += 1; this.isOpen = false; return 'OK'; },
    async sendCommand(parts) {
      commands.push([...parts]);
      switch (parts[0]) {
        case 'XADD': return '1-0';
        case 'XGROUP': return 'OK';
        case 'XREADGROUP': return [['affiliate-events', [rawEntry]]];
        case 'XAUTOCLAIM': return ['0-0', []];
        case 'XACK': return 1;
        case 'INCR': attempts += 1; return attempts;
        case 'PEXPIRE': return 1;
        case 'DEL': return 1;
        case 'SET': return 'OK';
        default: throw new Error(`unexpected command ${parts[0]}`);
      }
    }
  };
}

test('node-redis compatibility adapter connects once and preserves raw RESP command shapes', async () => {
  const raw = rawNodeRedis();
  const seenOptions = [];
  const client = await connectNodeRedisCompat({
    url: 'redis://redis.example:6379/0',
    createClientFn(options) { seenOptions.push(options); return raw; }
  });

  assert.deepEqual(seenOptions, [{ url: 'redis://redis.example:6379/0' }]);
  assert.equal(raw.connected, 1);
  assert.equal(raw.listeners.some((entry) => entry.event === 'error'), true);

  await client.xadd('affiliate-events', '*', 'tenantId', 'org-A', 'type', 'click.recorded');
  await client.set('dedupe:k', '1', 'PX', 60_000, 'NX');
  assert.deepEqual(raw.commands[0], ['XADD', 'affiliate-events', '*', 'tenantId', 'org-A', 'type', 'click.recorded']);
  assert.deepEqual(raw.commands[1], ['SET', 'dedupe:k', '1', 'PX', '60000', 'NX']);

  await client.close();
  assert.equal(raw.quitCalls, 1);
  await client.close();
  assert.equal(raw.quitCalls, 1, 'close must be idempotent');
});

test('durable consumer operates through node-redis raw command adapter', async () => {
  const raw = rawNodeRedis();
  const client = await connectNodeRedisCompat({
    url: 'redis://redis.example:6379/0',
    createClientFn: () => raw
  });
  const consumer = createDurableStreamConsumer({ client, stream: 'affiliate-events', group: 'g', consumer: 'c' });
  const seen = [];
  const result = await consumer.consumeOnce(async (entry) => seen.push(entry.eventId));
  assert.deepEqual(seen, ['evt-node-redis']);
  assert.equal(result[0].status, 'acked');
  assert.ok(raw.commands.some((parts) => parts[0] === 'XGROUP'));
  assert.ok(raw.commands.some((parts) => parts[0] === 'XREADGROUP'));
  assert.ok(raw.commands.some((parts) => parts[0] === 'XACK'));
  await client.close();
});

test('stream publisher auto-connects a configured Redis URL and closes an owned client', async () => {
  const calls = [];
  let closed = 0;
  const publisher = createStreamPublisher({
    redisUrl: 'redis://redis.example:6379/0',
    allowMemoryFallback: false,
    redisConnector: async ({ url }) => ({
      async xadd(...args) { calls.push({ url, args }); return '1-0'; },
      async close() { closed += 1; }
    })
  });

  const result = await publisher.publish({
    stream: 'affiliate-events',
    tenantId: 'org-A',
    type: 'conversion.recorded',
    eventId: 'evt-runtime',
    payload: { orderRef: 'o9' }
  });
  assert.equal(result.backend, 'redis');
  assert.equal(publisher.backendKind(), 'redis');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'redis://redis.example:6379/0');
  assert.match(calls[0].args.join('|'), /eventId\|evt-runtime/);

  await publisher.close();
  assert.equal(closed, 1);
});

test('stream publisher fails closed when configured Redis connector cannot connect', async () => {
  const publisher = createStreamPublisher({
    redisUrl: 'redis://redis.example:6379/0',
    allowMemoryFallback: false,
    redisConnector: async () => { throw new Error('connection refused'); }
  });
  await assert.rejects(
    () => publisher.publish({ stream: 's', tenantId: 'org-A', type: 'click.recorded', payload: {} }),
    /configured but no usable Redis client.*connection refused/i
  );
});

const liveUrl = String(process.env.REDIS_INTEGRATION_URL ?? '').trim();
test('declared redis package publishes and consumes a real Redis Stream', { skip: !liveUrl }, async () => {
  const client = await connectNodeRedisCompat({ url: liveUrl });
  const stream = `zaffiliate:test:${process.pid}:${Date.now()}`;
  const publisher = createStreamPublisher({ client, allowMemoryFallback: false });
  const consumer = createDurableStreamConsumer({
    client,
    stream,
    group: `g-${process.pid}`,
    consumer: `c-${process.pid}`
  });
  try {
    await publisher.publish({
      stream,
      tenantId: '00000000-0000-4000-8000-000000000001',
      type: 'conversion.recorded',
      eventId: 'evt-live-redis',
      payload: { orderRef: 'live-1' }
    });
    const seen = [];
    const result = await consumer.consumeOnce(async (entry) => seen.push(entry.eventId));
    assert.deepEqual(seen, ['evt-live-redis']);
    assert.equal(result[0].status, 'acked');
  } finally {
    await client.close();
  }
});
