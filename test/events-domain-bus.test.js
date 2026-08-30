import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainEventBus } from '../packages/events/src/index.js';

test('domain event bus records exhausted deliveries in its bounded DLQ', () => {
  const bus = createDomainEventBus({ maxAttempts: 2, deadLetterCapacity: 2, clock: () => '2026-08-30T00:00:00.000Z' });
  let attempts = 0;
  bus.subscribe('tenant-a', 'conversion.recorded', () => { attempts += 1; throw new Error('sink unavailable'); });
  bus.publish('tenant-a', { eventId: 'evt-1', type: 'conversion.recorded', payload: { order: 'o1' } });
  assert.equal(attempts, 2);
  assert.equal(bus.deadLetterCount(), 1);
  assert.deepEqual(bus.getDeadLetters()[0], {
    envelope: {
      eventId: 'evt-1', tenantId: 'tenant-a', type: 'conversion.recorded', payload: { order: 'o1' }, occurredAt: '2026-08-30T00:00:00.000Z'
    },
    attempts: 2,
    failedAt: '2026-08-30T00:00:00.000Z',
    error: 'sink unavailable'
  });
});

test('domain event bus evicts oldest dead letters at capacity', () => {
  const bus = createDomainEventBus({ maxAttempts: 1, deadLetterCapacity: 2 });
  bus.subscribe('tenant-a', 'x', () => { throw new Error('fail'); });
  for (const eventId of ['e1', 'e2', 'e3']) bus.publish('tenant-a', { eventId, type: 'x' });
  assert.deepEqual(bus.getDeadLetters().map((entry) => entry.envelope.eventId), ['e2', 'e3']);
});
