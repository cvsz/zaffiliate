import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamPublisher } from '../packages/events/src/redis-streams.js';

function fakeRedis() {
  const commands = [];
  return {
    commands,
    async xadd(stream, id, ...fields) {
      commands.push({ cmd: 'XADD', stream, id, fields });
      return `${Date.now()}-1`;
    }
  };
}

test('stream publisher writes tenant/type/payload triples via XADD', async () => {
  const client = fakeRedis();
  const publisher = createStreamPublisher({ client });
  const result = await publisher.publish({
    stream: 'affiliate-events',
    tenantId: 'org-A',
    type: 'conversion.recorded',
    payload: { orderRef: 'o1' },
    eventId: 'evt_9'
  });
  assert.equal(result.backend, 'redis');
  const cmd = client.commands[0];
  assert.equal(cmd.stream, 'affiliate-events');
  assert.equal(cmd.id, '*');
  const flat = cmd.fields.join('|');
  assert.match(flat, /tenantId\|org-A/);
  assert.match(flat, /type\|conversion\.recorded/);
  assert.match(flat, /eventId\|evt_9/);
  assert.match(flat, /payload\|/);
});

test('publisher falls back to an in-memory ring when no redis client is available', async () => {
  const publisher = createStreamPublisher({});
  const result = await publisher.publish({ stream: 's', tenantId: 'org-A', type: 'click.recorded', payload: {} });
  assert.equal(result.backend, 'memory');
  assert.equal(publisher.memorySize('s'), 1);
});

test('publishes validate required fields', async () => {
  const publisher = createStreamPublisher({ client: fakeRedis() });
  await assert.rejects(() => publisher.publish({ stream: '', tenantId: 'org-A', type: 'x', payload: {} }), /stream is required/i);
  await assert.rejects(() => publisher.publish({ stream: 's', tenantId: 'org-A', type: '', payload: {} }), /type is required/i);
});
