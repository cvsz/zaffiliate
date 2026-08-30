import test from 'node:test';
import assert from 'node:assert/strict';
import { createAffiliateOutboxDispatcher } from '../packages/events/src/outbox-dispatcher.js';

function event(id = 'evt_1') {
  return Object.freeze({
    eventId: id,
    tenantId: '00000000-0000-0000-0000-000000000001',
    type: 'conversion.recorded',
    payload: Object.freeze({ conversionId: 'cnv_1' }),
    occurredAt: '2026-08-30T00:00:00.000Z',
    attempts: 1
  });
}

test('outbox dispatcher marks rows only after stream publish succeeds', async () => {
  const calls = [];
  const repo = {
    async claimOutbox() { return [event()]; },
    async markOutboxDispatched(tenantId, eventId) { calls.push(['mark', tenantId, eventId]); return true; },
    async releaseOutbox() { calls.push(['release']); return true; }
  };
  const publisher = {
    async publish(input) { calls.push(['publish', input]); }
  };
  const dispatcher = createAffiliateOutboxDispatcher({ repo, publisher, workerId: 'test-worker' });
  const result = await dispatcher.dispatchOnce('00000000-0000-0000-0000-000000000001');
  assert.deepEqual(result, { claimed: 1, published: 1, failed: 0 });
  assert.equal(calls[0][0], 'publish');
  assert.equal(calls[0][1].eventId, 'evt_1');
  assert.equal(calls[1][0], 'mark');
  assert.equal(calls.some(([name]) => name === 'release'), false);
});

test('outbox dispatcher releases lease when stream publish fails', async () => {
  const calls = [];
  const repo = {
    async claimOutbox() { return [event('evt_retry')]; },
    async markOutboxDispatched() { calls.push(['mark']); return true; },
    async releaseOutbox(tenantId, eventId, error, options) { calls.push(['release', tenantId, eventId, error.message, options.retryDelayMs]); return true; }
  };
  const publisher = { async publish() { throw new Error('redis unavailable'); } };
  const dispatcher = createAffiliateOutboxDispatcher({ repo, publisher, workerId: 'test-worker', retryDelayMs: 2500 });
  const result = await dispatcher.dispatchOnce('00000000-0000-0000-0000-000000000001');
  assert.deepEqual(result, { claimed: 1, published: 0, failed: 1 });
  assert.deepEqual(calls, [['release', '00000000-0000-0000-0000-000000000001', 'evt_retry', 'redis unavailable', 2500]]);
});

test('outbox dispatcher treats failed database acknowledgement as retryable', async () => {
  const released = [];
  const repo = {
    async claimOutbox() { return [event('evt_ack')]; },
    async markOutboxDispatched() { return false; },
    async releaseOutbox(_tenantId, eventId, error) { released.push([eventId, error.message]); return true; }
  };
  const publisher = { async publish() {} };
  const dispatcher = createAffiliateOutboxDispatcher({ repo, publisher, workerId: 'test-worker' });
  const result = await dispatcher.dispatchOnce('00000000-0000-0000-0000-000000000001');
  assert.equal(result.failed, 1);
  assert.match(released[0][1], /not marked dispatched/);
});
