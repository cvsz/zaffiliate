import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDurableStreamConsumer,
  createRedisIdempotencyStore,
  createStreamPublisher,
  decodeStreamEntry
} from '../packages/events/src/redis-streams.js';

function fakeRedis() {
  const commands = [];
  const values = new Map();
  const attempts = new Map();
  const reads = [];
  const claims = [];
  return {
    commands, reads, claims,
    queueRead(reply) { reads.push(reply); },
    queueClaim(reply) { claims.push(reply); },
    async xadd(stream, id, ...fields) { commands.push({ cmd: 'XADD', stream, id, fields }); return '1-0'; },
    async xgroup(...args) { commands.push({ cmd: 'XGROUP', args }); return 'OK'; },
    async xreadgroup(...args) { commands.push({ cmd: 'XREADGROUP', args }); return reads.shift() ?? null; },
    async xautoclaim(...args) { commands.push({ cmd: 'XAUTOCLAIM', args }); return claims.shift() ?? ['0-0', []]; },
    async xack(...args) { commands.push({ cmd: 'XACK', args }); return 1; },
    async incr(key) { const value = (attempts.get(key) ?? 0) + 1; attempts.set(key, value); return value; },
    async pexpire(key, ttl) { commands.push({ cmd: 'PEXPIRE', key, ttl }); return 1; },
    async del(key) { values.delete(key); commands.push({ cmd: 'DEL', key }); return 1; },
    async set(key, value, mode, ttl, nx) {
      commands.push({ cmd: 'SET', key, value, mode, ttl, nx });
      if (nx === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }
  };
}

const rawEntry = ['1-0', ['tenantId', 'org-A', 'type', 'conversion.recorded', 'eventId', 'evt_9', 'payload', '{"orderRef":"o1"}']];

test('stream publisher writes tenant/type/payload fields via XADD', async () => {
  const client = fakeRedis();
  const publisher = createStreamPublisher({ client });
  const result = await publisher.publish({ stream: 'affiliate-events', tenantId: 'org-A', type: 'conversion.recorded', payload: { orderRef: 'o1' }, eventId: 'evt_9' });
  assert.equal(result.backend, 'redis');
  const cmd = client.commands[0];
  assert.equal(cmd.stream, 'affiliate-events');
  assert.equal(cmd.id, '*');
  assert.match(cmd.fields.join('|'), /eventId\|evt_9/);
});

test('publisher falls back to a bounded in-memory ring outside production', async () => {
  const publisher = createStreamPublisher({ allowMemoryFallback: true });
  const result = await publisher.publish({ stream: 's', tenantId: 'org-A', type: 'click.recorded', payload: {} });
  assert.equal(result.backend, 'memory');
  assert.equal(publisher.memorySize('s'), 1);
});

test('publisher fails closed when memory fallback is disabled', async () => {
  const publisher = createStreamPublisher({ allowMemoryFallback: false });
  await assert.rejects(() => publisher.publish({ stream: 's', tenantId: 'org-A', type: 'click.recorded', payload: {} }), /redis client is required/i);
});

test('decodeStreamEntry validates and parses the canonical envelope', () => {
  assert.deepEqual(decodeStreamEntry(rawEntry), {
    id: '1-0', eventId: 'evt_9', tenantId: 'org-A', type: 'conversion.recorded', payload: { orderRef: 'o1' }
  });
});

test('durable consumer creates a group and ACKs successful delivery', async () => {
  const client = fakeRedis();
  client.queueRead([['affiliate-events', [rawEntry]]]);
  const consumer = createDurableStreamConsumer({ client, stream: 'affiliate-events', group: 'g', consumer: 'c' });
  const seen = [];
  const result = await consumer.consumeOnce(async (entry) => seen.push(entry.eventId));
  assert.deepEqual(seen, ['evt_9']);
  assert.equal(result[0].status, 'acked');
  assert.ok(client.commands.some((command) => command.cmd === 'XGROUP'));
  assert.ok(client.commands.some((command) => command.cmd === 'XACK'));
  const read = client.commands.find((command) => command.cmd === 'XREADGROUP');
  assert.equal(read.args.includes('BLOCK'), false, 'default consumeOnce must not issue Redis BLOCK 0');
});

test('durable consumer only sends BLOCK when a positive timeout is requested', async () => {
  const client = fakeRedis();
  client.queueRead(null);
  const consumer = createDurableStreamConsumer({ client, stream: 'affiliate-events', group: 'g', consumer: 'c' });
  await consumer.consumeOnce(async () => {}, { blockMs: 250 });
  const read = client.commands.find((command) => command.cmd === 'XREADGROUP');
  const blockIndex = read.args.indexOf('BLOCK');
  assert.equal(read.args[blockIndex + 1], 250);
});

test('durable consumer leaves retriable failures pending then sends exhausted messages to DLQ', async () => {
  const client = fakeRedis();
  const consumer = createDurableStreamConsumer({ client, stream: 'affiliate-events', group: 'g', consumer: 'c', maxAttempts: 2 });
  client.queueRead([['affiliate-events', [rawEntry]]]);
  const first = await consumer.consumeOnce(async () => { throw new Error('boom'); });
  assert.equal(first[0].status, 'retry');
  assert.equal(client.commands.filter((command) => command.cmd === 'XACK').length, 0);

  client.queueClaim(['0-0', [rawEntry]]);
  const second = await consumer.reclaimOnce(async () => { throw new Error('boom'); });
  assert.equal(second[0].status, 'dead-lettered');
  const dlq = client.commands.find((command) => command.cmd === 'XADD' && command.stream === 'affiliate-events:dlq');
  assert.ok(dlq);
  assert.ok(client.commands.some((command) => command.cmd === 'XACK'));
});

test('idempotency store makes redelivery exactly-once-effective', async () => {
  const client = fakeRedis();
  const dedupeStore = createRedisIdempotencyStore({ client, ttlMs: 60_000 });
  const consumer = createDurableStreamConsumer({ client, stream: 'affiliate-events', group: 'g', consumer: 'c', dedupeStore });
  let calls = 0;

  client.queueRead([['affiliate-events', [rawEntry]]]);
  const first = await consumer.consumeOnce(async () => { calls += 1; });
  assert.equal(first[0].status, 'acked');

  client.queueRead([['affiliate-events', [['2-0', rawEntry[1]]]]]);
  const second = await consumer.consumeOnce(async () => { calls += 1; });
  assert.equal(second[0].status, 'duplicate');
  assert.equal(calls, 1);
});
