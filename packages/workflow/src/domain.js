function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const JobStates = Object.freeze(['queued','running','waiting_approval','succeeded','failed','cancelled','dead_letter']);

const transitions = Object.freeze({
  queued: ['running','cancelled'],
  running: ['waiting_approval','succeeded','failed','cancelled'],
  waiting_approval: ['running','cancelled','failed'],
  failed: ['queued','dead_letter','cancelled'],
  succeeded: [],
  cancelled: [],
  dead_letter: []
});

export function createJob({ tenantId, jobId, actorId, action, resourceId, idempotencyKey, requiresApproval = false, createdAt = new Date().toISOString() }) {
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    jobId: required(jobId, 'jobId'),
    actorId: required(actorId, 'actorId'),
    action: required(action, 'action'),
    resourceId: required(resourceId, 'resourceId'),
    idempotencyKey: required(idempotencyKey, 'idempotencyKey'),
    requiresApproval: Boolean(requiresApproval),
    state: 'queued',
    attempts: 0,
    createdAt
  });
}

export function transitionJob(job, nextState) {
  const current = required(job?.state, 'state');
  const next = required(nextState, 'nextState');
  if (!JobStates.includes(next) || !transitions[current]?.includes(next)) throw new Error(`invalid job transition: ${current} -> ${next}`);
  return Object.freeze({ ...job, state: next, attempts: next === 'running' ? Number(job.attempts || 0) + 1 : Number(job.attempts || 0) });
}

export function createApproval({ tenantId, approvalId, job, approverId, decision, expiresAt, decidedAt = new Date().toISOString() }) {
  if (!job || job.tenantId !== tenantId) throw new Error('job tenant mismatch');
  const normalizedDecision = required(decision, 'decision').toLowerCase();
  if (!['approved','rejected','cancelled'].includes(normalizedDecision)) throw new Error('unsupported approval decision');
  return Object.freeze({
    tenantId: required(tenantId, 'tenantId'),
    approvalId: required(approvalId, 'approvalId'),
    jobId: job.jobId,
    actorId: job.actorId,
    action: job.action,
    resourceId: job.resourceId,
    idempotencyKey: job.idempotencyKey,
    approverId: required(approverId, 'approverId'),
    decision: normalizedDecision,
    expiresAt: new Date(required(expiresAt, 'expiresAt')).toISOString(),
    decidedAt: new Date(decidedAt).toISOString()
  });
}

export function requireValidApproval({ job, approval, now = new Date() }) {
  if (!job?.requiresApproval) return Object.freeze({ allowed: true, reason: 'approval_not_required' });
  if (!approval) throw Object.assign(new Error('approval required'), { code: 'APPROVAL_REQUIRED' });
  const bindingMatches = approval.tenantId === job.tenantId && approval.jobId === job.jobId && approval.actorId === job.actorId && approval.action === job.action && approval.resourceId === job.resourceId && approval.idempotencyKey === job.idempotencyKey;
  if (!bindingMatches) throw Object.assign(new Error('approval binding mismatch'), { code: 'APPROVAL_BINDING_MISMATCH' });
  if (approval.decision !== 'approved') throw Object.assign(new Error(`approval ${approval.decision}`), { code: 'APPROVAL_DENIED' });
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) throw Object.assign(new Error('approval expired'), { code: 'APPROVAL_EXPIRED' });
  return Object.freeze({ allowed: true, reason: 'approved', approvalId: approval.approvalId });
}

export function registerIdempotencyAttempt(store, { tenantId, idempotencyKey, fingerprint }) {
  const key = `${required(tenantId, 'tenantId')}:${required(idempotencyKey, 'idempotencyKey')}`;
  const fp = required(fingerprint, 'fingerprint');
  const existing = store.get(key);
  if (!existing) {
    const record = Object.freeze({ tenantId, idempotencyKey, fingerprint: fp, status: 'in_progress' });
    store.set(key, record);
    return Object.freeze({ duplicate: false, record });
  }
  if (existing.fingerprint !== fp) throw Object.assign(new Error('idempotency key reused with different request'), { code: 'IDEMPOTENCY_CONFLICT' });
  return Object.freeze({ duplicate: true, record: existing });
}
