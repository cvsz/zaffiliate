import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRuntime } from '../packages/workflow/src/runtime.js';

function fixedClock(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms) => { now += ms; } };
}

function setup({ clock } = {}) {
  const time = clock ?? fixedClock();
  const runtime = createWorkflowRuntime({
    clock: time.now,
    maxAttempts: 2,
    approvalTtlMs: 60_000,
    staleRunningMs: 300_000
  });
  return { time, runtime };
}

test('enqueue is idempotent on tenant+idempotencyKey and replays the original job', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['outreach.send'], allowedActors: ['bot'], requiresApproval: false });
  const first = runtime.enqueueJob({ tenantId: 't1', jobType: 'send', payload: { channel: 'email' }, actor: 'bot', idempotencyKey: 'idem-1', tool: 'crm', action: 'outreach.send', resourceId: 'msg-1' });
  assert.equal(first.duplicate, false);
  const replay = runtime.enqueueJob({ tenantId: 't1', jobType: 'send', payload: { channel: 'email' }, actor: 'bot', idempotencyKey: 'idem-1', tool: 'crm', action: 'outreach.send', resourceId: 'msg-1' });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.job.jobId, first.job.jobId);
});

test('enqueue fails closed without a covering tool grant', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['outreach.send'], allowedActors: ['bot'] });
  assert.throws(() => runtime.enqueueJob({ tenantId: 't1', jobType: 'x', actor: 'intruder', idempotencyKey: 'k', tool: 'crm', action: 'outreach.send', resourceId: 'r' }), /tool grant denied|TOOL_GRANT_DENIED|tool_grant_denied/i);
  assert.throws(() => runtime.enqueueJob({ tenantId: 't1', jobType: 'x', actor: 'bot', idempotencyKey: 'k', tool: 'ghost', action: 'nope', resourceId: 'r' }), /tool grant denied|TOOL_GRANT_DENIED|tool_grant_denied/i);
});

test('claiming is atomic: each claim returns a distinct running job', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one', 'a.two'], allowedActors: ['bot'] });
  runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k2', tool: 'crm', action: 'a.two', resourceId: 'r2' });
  const first = runtime.claimJob({ workerId: 'w1' });
  const second = runtime.claimJob({ workerId: 'w2' });
  assert.ok(first && second);
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(first.state, 'running');
  assert.equal(second.workerId, 'w2');
  assert.equal(runtime.claimJob({ workerId: 'w3' }), null);
});

test('failed jobs retry with backoff then land in dead_letter after maxAttempts', () => {
  const { time, runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  const claimed = runtime.claimJob({ workerId: 'w1' });
  runtime.failJob('t1', claimed.jobId, { error: 'provider down' });
  assert.equal(runtime.getJob('t1', claimed.jobId).state, 'queued');
  assert.equal(runtime.getJob('t1', claimed.jobId).attempts, 1);
  time.advance(4000);
  const again = runtime.claimJob({ workerId: 'w1' });
  assert.equal(again.attempts, 2);
  runtime.failJob('t1', again.jobId, { error: 'still down' });
  const dead = runtime.listDeadLetters('t1');
  assert.equal(dead.length, 1);
  assert.equal(dead[0].state, 'dead_letter');
  assert.match(dead[0].failureReason, /still down/);
  assert.equal(runtime.claimJob({ workerId: 'w1' }), null);
});

test('running jobs cancel in two phases', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  runtime.claimJob({ workerId: 'w1' });
  const cancelling = runtime.cancelJob('t1', job.jobId, { actor: 'op', reason: 'bad payload' });
  assert.equal(cancelling.state, 'running');
  const cancelled = runtime.confirmCancel('t1', job.jobId);
  assert.equal(cancelled.state, 'cancelled');
  assert.throws(() => runtime.confirmCancel('t1', job.jobId), /no pending cancellation/);
});

test('approval-gated jobs are unclaimable until bound approval is granted; expiry is fail-closed', () => {
  const { time, runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'publish', actions: ['content.publish'], allowedActors: ['agent'], requiresApproval: true });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'publish', actor: 'agent', idempotencyKey: 'k1', tool: 'publish', action: 'content.publish', resourceId: 'post-1' });

  assert.equal(runtime.claimJob({ workerId: 'w1' }), null);
  assert.equal(runtime.getJob('t1', job.jobId).state, 'queued');

  const approval = runtime.requestApproval('t1', job.jobId, { actor: 'agent' });
  time.advance(120_000);
  assert.throws(() => runtime.decideApproval('t1', approval.approvalId, { decision: 'approve', actor: 'admin' }), (error) => error.code === 'APPROVAL_EXPIRED');

  const approval2 = runtime.requestApproval('t1', job.jobId, { actor: 'agent' });
  const decided = runtime.decideApproval('t1', approval2.approvalId, { decision: 'approve', actor: 'admin' });
  assert.equal(decided.decision, 'approved');

  const runnable = runtime.claimJob({ workerId: 'w1' });
  assert.ok(runnable);
  assert.equal(runnable.jobId, job.jobId);
  assert.equal(runnable.state, 'running');
  const done = runtime.completeJob('t1', job.jobId, { result: { ok: true } });
  assert.equal(done.state, 'succeeded');
});

test('rejected pre-claim approval cancels the queued job', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'publish', actions: ['content.publish'], allowedActors: ['agent'], requiresApproval: true });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'p', actor: 'agent', idempotencyKey: 'k1', tool: 'publish', action: 'content.publish', resourceId: 'r' });
  const approval = runtime.requestApproval('t1', job.jobId, { actor: 'agent' });
  const decided = runtime.decideApproval('t1', approval.approvalId, { decision: 'reject', actor: 'admin' });
  assert.equal(decided.decision, 'rejected');
  const updated = runtime.getJob('t1', job.jobId);
  assert.equal(updated.state, 'cancelled');
  assert.match(updated.failureReason, /approval rejected/);
});

test('running jobs can suspend for approval and resume on approve', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  const claimed = runtime.claimJob({ workerId: 'w1' });
  assert.equal(claimed.state, 'running');
  const approval = runtime.requestApproval('t1', job.jobId, { actor: 'bot' });
  assert.equal(runtime.getJob('t1', job.jobId).state, 'waiting_approval');
  runtime.decideApproval('t1', approval.approvalId, { decision: 'approve', actor: 'admin' });
  const resumed = runtime.getJob('t1', job.jobId);
  assert.equal(resumed.state, 'running');
  const done = runtime.completeJob('t1', job.jobId, {});
  assert.equal(done.state, 'succeeded');
});

test('reconciliation requeues stale running jobs exactly once', () => {
  const { time, runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  runtime.claimJob({ workerId: 'w1' });
  time.advance(400_000);
  const requeued = runtime.reconcile({});
  assert.equal(requeued.length, 1);
  assert.equal(requeued[0].jobId, job.jobId);
  assert.equal(requeued[0].state, 'queued');
  assert.deepEqual(runtime.reconcile({}), []);
});

test('cross-tenant job access throws', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  const { job } = runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  assert.throws(() => runtime.getJob('tenant-b', job.jobId), /job not found/);
});

test('outbox records ordered state transitions and drains safely', () => {
  const { runtime } = setup();
  runtime.registerToolGrant({ tenantId: 't1', tool: 'crm', actions: ['a.one'], allowedActors: ['bot'] });
  runtime.enqueueJob({ tenantId: 't1', jobType: 'j', actor: 'bot', idempotencyKey: 'k1', tool: 'crm', action: 'a.one', resourceId: 'r1' });
  const claimed = runtime.claimJob({ workerId: 'w1' });
  runtime.completeJob('t1', claimed.jobId, {});
  const events = runtime.listOutbox('t1');
  const types = events.map((event) => event.type);
  assert.deepStrictEqual(types, ['workflow.job.queued', 'workflow.job.running', 'workflow.job.succeeded']);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  const drained = runtime.drainOutbox('t1', { limit: 10 });
  assert.equal(drained.length, 3);
  assert.equal(runtime.listOutbox('t1').length, 0);
});
