import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCreatorContact, contactDedupeKey, canSendOutreach, createOutboxMessage, transitionOutboxMessage } from '../packages/outreach/src/domain.js';

test('creator contact normalizes identity and dedupe key', () => {
  const contact = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c1', email: 'USER@EXAMPLE.COM ', consent: true });
  assert.equal(contact.email, 'user@example.com');
  assert.equal(contactDedupeKey(contact), 'tenant-a:email:user@example.com');
});

test('consent and suppression fail closed', () => {
  const noConsent = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c1', handle: 'creator', platform: 'tiktok', consent: false });
  assert.deepEqual(canSendOutreach({ contact: noConsent, now: new Date('2026-08-22T12:00:00Z') }), { allowed: false, reason: 'consent_required' });
  const suppressed = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c2', handle: 'creator2', platform: 'tiktok', consent: true, suppressed: true });
  assert.deepEqual(canSendOutreach({ contact: suppressed, now: new Date('2026-08-22T12:00:00Z') }), { allowed: false, reason: 'suppressed' });
});

test('quiet hours and daily budget are enforced', () => {
  const contact = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c1', email: 'x@example.com', consent: true });
  assert.equal(canSendOutreach({ contact, now: new Date('2026-08-22T22:00:00Z') }).reason, 'quiet_hours');
  assert.equal(canSendOutreach({ contact, now: new Date('2026-08-22T12:00:00Z'), sentToday: 50, dailyBudget: 50 }).reason, 'daily_budget_exhausted');
});

test('outbox lifecycle is durable-state compatible and rejects invalid transitions', () => {
  const contact = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c1', email: 'x@example.com', consent: true });
  let message = createOutboxMessage({ tenantId: 'tenant-a', messageId: 'm1', contact, channel: 'email', templateVersion: 'intro-v1', subject: 'Hello', body: 'Body', idempotencyKey: 'tenant-a:m1' });
  message = transitionOutboxMessage(message, 'sending');
  assert.equal(message.attempts, 1);
  message = transitionOutboxMessage(message, 'sent');
  assert.equal(message.status, 'sent');
  assert.throws(() => transitionOutboxMessage(message, 'sending'), /invalid outbox transition/);
});

test('cross-tenant outbox composition is rejected', () => {
  const contact = normalizeCreatorContact({ tenantId: 'tenant-a', creatorId: 'c1', email: 'x@example.com', consent: true });
  assert.throws(() => createOutboxMessage({ tenantId: 'tenant-b', messageId: 'm1', contact, channel: 'email', templateVersion: 'v1', body: 'x', idempotencyKey: 'k' }), /tenant mismatch/);
});
