import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutreachRuntime } from '../packages/outreach/src/runtime.js';

const T0 = '2026-08-20T12:00:00Z';
const T0_MS = Date.parse(T0);

function clockAt(ms = T0_MS) {
  return () => ms;
}

function hoursLater(hours) {
  return new Date(T0_MS + hours * 3600000).toISOString();
}

function okTransport(log = []) {
  return message => {
    log.push(message);
    return { ok: true, externalId: `ext-${log.length}` };
  };
}

function seededContact(runtime, tenantId = 't1', contactId = 'c1') {
  return runtime.upsertContact(tenantId, {
    contactId,
    email: `${contactId}@example.com`,
    channels: [{ channel: 'email', address: `${contactId}@example.com` }],
    consentState: 'granted'
  });
}

test('dedupe returns the existing attempt without duplicate creation', () => {
  const runtime = createOutreachRuntime({ clock: clockAt() });
  seededContact(runtime);
  const spec = { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' };
  const first = runtime.enqueueMessage('t1', spec);
  const second = runtime.enqueueMessage('t1', { ...spec, variables: { ignored: true } });
  assert.equal(second, first);
  assert.equal(runtime.listAttempts('t1').length, 1);
  assert.equal(runtime.listEvents('t1').filter(event => event.type === 'outreach.attempt.queued').length, 1);

  const otherCampaign = runtime.enqueueMessage('t1', { ...spec, campaignRef: 'camp-2' });
  assert.notEqual(otherCampaign.attemptId, first.attemptId);

  runtime.upsertContact('t2', {
    contactId: 'c1',
    email: 'c1@example.com',
    channels: [{ channel: 'email', address: 'c1@example.com' }],
    consentState: 'granted'
  });
  const crossTenant = runtime.enqueueMessage('t2', spec);
  assert.notEqual(crossTenant.attemptId, first.attemptId);
  assert.equal(runtime.listAttempts('t2').length, 1);
});

test('suppression blocks send even with consent later revoked mid-flight', () => {
  const calls = [];
  const runtime = createOutreachRuntime({ clock: clockAt() });
  seededContact(runtime);
  const attempt = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  runtime.suppress('t1', 'c1', { reason: 'user_request' });
  runtime.revokeConsent('t1', 'c1');
  const summary = runtime.processQueue({ now: T0, transport: okTransport(calls) });

  const updated = runtime.getAttempt('t1', attempt.attemptId);
  assert.equal(updated.state, 'skipped_suppressed');
  assert.equal(updated.reason, 'suppressed');
  assert.equal(calls.length, 0);
  assert.equal(summary.skippedSuppressed, 1);

  const revokedOnly = createOutreachRuntime({ clock: clockAt() });
  seededContact(revokedOnly);
  const attempt2 = revokedOnly.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  revokedOnly.revokeConsent('t1', 'c1');
  const calls2 = [];
  revokedOnly.processQueue({ now: T0, transport: okTransport(calls2) });
  const updated2 = revokedOnly.getAttempt('t1', attempt2.attemptId);
  assert.equal(updated2.state, 'skipped_suppressed');
  assert.equal(updated2.reason, 'consent_revoked');
  assert.equal(calls2.length, 0);
});

test('quiet hours defer the attempt and keep it queued for the next window', () => {
  const calls = [];
  const runtime = createOutreachRuntime({ clock: clockAt() });
  seededContact(runtime);
  const attempt = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });

  const deferred = runtime.processQueue({ now: '2026-08-20T03:00:00Z', transport: okTransport(calls) });
  const afterQuiet = runtime.getAttempt('t1', attempt.attemptId);
  assert.equal(afterQuiet.state, 'queued');
  assert.equal(deferred.skippedQuietHours, 1);
  assert.equal(calls.length, 0);
  assert.ok(runtime.listEvents('t1').some(event => event.type === 'outreach.attempt.skipped_quiet_hours' && event.attemptId === attempt.attemptId));

  runtime.processQueue({ now: T0, transport: okTransport(calls) });
  const sent = runtime.getAttempt('t1', attempt.attemptId);
  assert.equal(sent.state, 'sent');
  assert.equal(calls.length, 1);
});

test('per-channel daily budget exhaustion skips without invoking provider', () => {
  const calls = [];
  const runtime = createOutreachRuntime({ clock: clockAt(), dailyBudgetPerChannel: 1 });
  seededContact(runtime, 't1', 'c1');
  seededContact(runtime, 't1', 'c2');
  const a1 = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  const a2 = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c2', channel: 'email' });

  const summary = runtime.processQueue({ now: T0, transport: okTransport(calls) });
  assert.equal(runtime.getAttempt('t1', a1.attemptId).state, 'sent');
  assert.equal(runtime.getAttempt('t1', a2.attemptId).state, 'skipped_budget');
  assert.equal(summary.sent, 1);
  assert.equal(summary.skippedBudget, 1);
  assert.equal(calls.length, 1);
});

test('failed sends retry up to the cap then dead-letter', () => {
  const runtime = createOutreachRuntime({ clock: clockAt(), maxAttempts: 2 });
  seededContact(runtime);
  const attempt = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  const failing = () => ({ ok: false, error: 'provider_down' });

  const firstPass = runtime.processQueue({ now: T0, transport: failing });
  const requeued = runtime.getAttempt('t1', attempt.attemptId);
  assert.equal(requeued.state, 'queued');
  assert.equal(requeued.attempts, 1);
  assert.equal(requeued.failureReason, 'provider_down');
  assert.equal(firstPass.retried, 1);

  const secondPass = runtime.processQueue({ now: hoursLater(1), transport: failing });
  const dead = runtime.getAttempt('t1', attempt.attemptId);
  assert.equal(dead.state, 'dead_letter');
  assert.equal(dead.attempts, 2);
  assert.equal(secondPass.deadLettered, 1);

  const types = runtime.listEvents('t1').filter(event => event.attemptId === attempt.attemptId).map(event => event.type);
  assert.deepEqual(types, [
    'outreach.attempt.queued',
    'outreach.attempt.sending',
    'outreach.attempt.failed',
    'outreach.attempt.queued',
    'outreach.attempt.sending',
    'outreach.attempt.failed',
    'outreach.attempt.dead_letter'
  ]);
});

test('follow-up materializes only when the no_reply condition holds', () => {
  const repliedCalls = [];
  const repliedRuntime = createOutreachRuntime({ clock: clockAt() });
  seededContact(repliedRuntime);
  const parent = repliedRuntime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  repliedRuntime.processQueue({ now: T0, transport: okTransport(repliedCalls) });
  repliedRuntime.recordReply('t1', parent.attemptId, { at: hoursLater(1) });
  const followUp = repliedRuntime.scheduleFollowUp('t1', { parentAttemptId: parent.attemptId, templateId: 'nudge', delayHours: 24, condition: 'no_reply' });

  repliedRuntime.processQueue({ now: hoursLater(25), transport: okTransport(repliedCalls) });
  const evaluated = repliedRuntime.listFollowUps('t1').find(entry => entry.followUpId === followUp.followUpId);
  assert.equal(evaluated.state, 'not_met');
  assert.equal(evaluated.materializedAttemptId, null);
  assert.equal(repliedRuntime.listAttempts('t1').length, 1);
  assert.equal(repliedCalls.length, 1);

  const openCalls = [];
  const openRuntime = createOutreachRuntime({ clock: clockAt() });
  seededContact(openRuntime);
  const parent2 = openRuntime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  openRuntime.processQueue({ now: T0, transport: okTransport(openCalls) });
  const followUp2 = openRuntime.scheduleFollowUp('t1', { parentAttemptId: parent2.attemptId, templateId: 'nudge', delayHours: 24, condition: 'no_reply' });

  openRuntime.processQueue({ now: hoursLater(23), transport: okTransport(openCalls) });
  const pending = openRuntime.listFollowUps('t1').find(entry => entry.followUpId === followUp2.followUpId);
  assert.equal(pending.state, 'contingent');
  assert.equal(openRuntime.listAttempts('t1').length, 1);

  openRuntime.processQueue({ now: hoursLater(25), transport: okTransport(openCalls) });
  const materialized = openRuntime.listFollowUps('t1').find(entry => entry.followUpId === followUp2.followUpId);
  assert.equal(materialized.state, 'materialized');
  assert.ok(materialized.materializedAttemptId);
  const childAttempt = openRuntime.getAttempt('t1', materialized.materializedAttemptId);
  assert.equal(childAttempt.state, 'sent');
  assert.equal(childAttempt.followUpOf, followUp2.followUpId);
  assert.equal(openRuntime.listAttempts('t1').length, 2);
  assert.equal(openCalls.length, 2);
});

test('hourly per-contact guardrail cap skips excess sends', () => {
  const calls = [];
  const runtime = createOutreachRuntime({ clock: clockAt(), hourlySendCapPerContact: 2 });
  seededContact(runtime);
  const specs = [
    { templateId: 'm1', templateVersion: 'v1', contactId: 'c1', channel: 'email', campaignRef: 'a' },
    { templateId: 'm2', templateVersion: 'v1', contactId: 'c1', channel: 'email', campaignRef: 'b' },
    { templateId: 'm3', templateVersion: 'v1', contactId: 'c1', channel: 'email', campaignRef: 'c' }
  ];
  const attempts = specs.map(spec => runtime.enqueueMessage('t1', spec));
  const summary = runtime.processQueue({ now: T0, transport: okTransport(calls) });

  assert.equal(runtime.getAttempt('t1', attempts[0].attemptId).state, 'sent');
  assert.equal(runtime.getAttempt('t1', attempts[1].attemptId).state, 'sent');
  const guarded = runtime.getAttempt('t1', attempts[2].attemptId);
  assert.equal(guarded.state, 'skipped_guardrail');
  assert.equal(guarded.reason, 'hourly_cap_reached');
  assert.equal(summary.skippedGuardrail, 1);
  assert.equal(calls.length, 2);
});

test('attribution records delivery, reply and conversion on sent attempts only', () => {
  const runtime = createOutreachRuntime({ clock: clockAt() });
  seededContact(runtime);
  const attempt = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  runtime.processQueue({ now: T0, transport: okTransport([]) });

  const delivered = runtime.recordDelivery('t1', attempt.attemptId, { at: hoursLater(1) });
  assert.equal(delivered.deliveredAt, hoursLater(1));
  assert.equal(delivered.externalId, 'ext-1');
  assert.equal(runtime.recordDelivery('t1', attempt.attemptId, { at: hoursLater(2) }).deliveredAt, hoursLater(1));

  const replied = runtime.recordReply('t1', attempt.attemptId, { at: hoursLater(3) });
  assert.equal(replied.repliedAt, hoursLater(3));

  const converted = runtime.recordConversion('t1', attempt.attemptId, { at: hoursLater(5) });
  assert.equal(converted.convertedAt, hoursLater(5));

  const queuedRuntime = createOutreachRuntime({ clock: clockAt() });
  seededContact(queuedRuntime);
  const queued = queuedRuntime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email' });
  assert.throws(() => queuedRuntime.recordReply('t1', queued.attemptId), /state queued/);
});

test('outbox events are emitted per transition in strictly increasing order', () => {
  const captured = [];
  const runtime = createOutreachRuntime({ clock: clockAt() });
  seededContact(runtime);
  const attempt = runtime.enqueueMessage('t1', { templateId: 'intro', templateVersion: 'v1', contactId: 'c1', channel: 'email', variables: { name: 'Creator' }, campaignRef: 'camp-1' });
  runtime.processQueue({ now: T0, transport: message => {
    captured.push(message);
    return { ok: true, externalId: 'ext-9' };
  } });

  const events = runtime.listEvents('t1');
  assert.equal(events[0].sequence, 1);
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i].sequence > events[i - 1].sequence);
    assert.equal(events[i].tenantId, 't1');
    assert.match(events[i].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  }
  assert.deepEqual(events.map(event => event.type), ['outreach.attempt.queued', 'outreach.attempt.sending', 'outreach.attempt.sent']);
  assert.deepEqual(events.map(event => event.attemptId), [attempt.attemptId, attempt.attemptId, attempt.attemptId]);

  assert.equal(captured.length, 1);
  assert.deepEqual(Object.keys(captured[0]).sort(), ['address', 'attemptId', 'campaignRef', 'channel', 'contactId', 'followUpOf', 'templateId', 'templateVersion', 'tenantId', 'variables']);
  assert.equal(captured[0].address, 'c1@example.com');
});
