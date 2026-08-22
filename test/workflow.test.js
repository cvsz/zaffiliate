import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, transitionJob, createApproval, requireValidApproval, registerIdempotencyAttempt } from '../packages/workflow/src/domain.js';

test('job state machine rejects invalid transitions', () => {
  let job = createJob({ tenantId: 't1', jobId: 'j1', actorId: 'u1', action: 'publish', resourceId: 'c1', idempotencyKey: 'k1' });
  job = transitionJob(job, 'running');
  assert.equal(job.attempts, 1);
  job = transitionJob(job, 'succeeded');
  assert.throws(() => transitionJob(job, 'running'), /invalid job transition/);
});

test('approval is bound to tenant actor action resource and idempotency key', () => {
  const job = createJob({ tenantId: 't1', jobId: 'j1', actorId: 'u1', action: 'publish', resourceId: 'c1', idempotencyKey: 'k1', requiresApproval: true });
  const approval = createApproval({ tenantId: 't1', approvalId: 'a1', job, approverId: 'admin', decision: 'approved', expiresAt: '2026-08-23T00:00:00Z', decidedAt: '2026-08-22T00:00:00Z' });
  assert.equal(requireValidApproval({ job, approval, now: new Date('2026-08-22T12:00:00Z') }).allowed, true);
  const tampered = { ...approval, resourceId: 'other' };
  assert.throws(() => requireValidApproval({ job, approval: tampered, now: new Date('2026-08-22T12:00:00Z') }), (error) => error.code === 'APPROVAL_BINDING_MISMATCH');
});

test('expired or rejected approvals fail closed', () => {
  const job = createJob({ tenantId: 't1', jobId: 'j1', actorId: 'u1', action: 'publish', resourceId: 'c1', idempotencyKey: 'k1', requiresApproval: true });
  const expired = createApproval({ tenantId: 't1', approvalId: 'a1', job, approverId: 'admin', decision: 'approved', expiresAt: '2026-08-21T00:00:00Z' });
  assert.throws(() => requireValidApproval({ job, approval: expired, now: new Date('2026-08-22T00:00:00Z') }), (error) => error.code === 'APPROVAL_EXPIRED');
  const rejected = createApproval({ tenantId: 't1', approvalId: 'a2', job, approverId: 'admin', decision: 'rejected', expiresAt: '2026-08-23T00:00:00Z' });
  assert.throws(() => requireValidApproval({ job, approval: rejected, now: new Date('2026-08-22T00:00:00Z') }), (error) => error.code === 'APPROVAL_DENIED');
});

test('idempotency detects duplicates and conflicting reuse', () => {
  const store = new Map();
  const first = registerIdempotencyAttempt(store, { tenantId: 't1', idempotencyKey: 'k1', fingerprint: 'fp-a' });
  assert.equal(first.duplicate, false);
  assert.equal(registerIdempotencyAttempt(store, { tenantId: 't1', idempotencyKey: 'k1', fingerprint: 'fp-a' }).duplicate, true);
  assert.throws(() => registerIdempotencyAttempt(store, { tenantId: 't1', idempotencyKey: 'k1', fingerprint: 'fp-b' }), (error) => error.code === 'IDEMPOTENCY_CONFLICT');
});
