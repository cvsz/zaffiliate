import { randomUUID } from 'node:crypto';
import { JobStates, createJob, transitionJob, createApproval, requireValidApproval, registerIdempotencyAttempt } from './domain.js';

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function partition(state, tenantId) {
  if (!state.tenants.has(tenantId)) state.tenants.set(tenantId, { jobs: new Map(), idempotency: new Map(), grants: new Map(), approvals: new Map(), outbox: [], sequence: 0, deadLetters: [] });
  return state.tenants.get(tenantId);
}

function emit(part, type, payload, at) {
  const sequence = ++part.sequence;
  part.outbox.push(Object.freeze({ sequence, type, at, ...payload }));
}

export function createWorkflowRuntime({ clock = () => Date.now(), maxAttempts = 3, approvalTtlMs = 3600000, staleRunningMs = 300000 } = {}) {
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive number');
  if (!Number.isFinite(approvalTtlMs) || approvalTtlMs <= 0) throw new Error('approvalTtlMs must be positive');
  const state = { tenants: new Map() };
  const nowIso = () => new Date(clock()).toISOString();

  function registerToolGrant({ tenantId, tool, actions, allowedActors, requiresApproval = false }) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const normalizedTool = required(tool, 'tool');
    const normalizedActions = [...new Set((actions || []).map((action) => required(action, 'action')))];
    if (normalizedActions.length === 0) throw new Error('tool grant requires actions');
    const actors = [...new Set((allowedActors || []).map((actor) => required(actor, 'actor')))];
    if (actors.length === 0) throw new Error('tool grant requires allowedActors');
    part.grants.set(normalizedTool, Object.freeze({ tool: normalizedTool, actions: Object.freeze(normalizedActions), allowedActors: Object.freeze(actors), requiresApproval: Boolean(requiresApproval) }));
    return part.grants.get(normalizedTool);
  }

  function enqueueJob({ tenantId, jobType, payload, actor, idempotencyKey, tool, action, resourceId, requiresApproval }) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const normalizedActor = required(actor, 'actor');
    const normalizedTool = required(tool, 'tool');
    const normalizedAction = required(action || jobType, 'action');
    const key = required(idempotencyKey, 'idempotencyKey');
    const grant = part.grants.get(normalizedTool);
    if (!grant || !grant.actions.includes(normalizedAction) || !grant.allowedActors.includes(normalizedActor)) {
      throw Object.assign(new Error('tool grant denied'), { code: 'TOOL_GRANT_DENIED' });
    }
    const fingerprint = JSON.stringify({ jobType: required(jobType, 'jobType'), action: normalizedAction, resource: required(resourceId, 'resourceId'), tool: normalizedTool });
    const registration = registerIdempotencyAttempt(part.idempotency, { tenantId, idempotencyKey: key, fingerprint });
    if (registration.duplicate) {
      const existing = [...part.jobs.values()].find((job) => job.idempotencyKey === key);
      return { duplicate: true, job: existing };
    }
    const jobId = `job_${randomUUID()}`;
    let job = createJob({ tenantId, jobId, actorId: normalizedActor, action: normalizedAction, resourceId, idempotencyKey: key, requiresApproval: requiresApproval ?? grant.requiresApproval, createdAt: nowIso() });
    job = { ...job, jobType: required(jobType, 'jobType'), tool: normalizedTool, payload: Object.freeze(structuredClone(payload ?? {})), backoffAt: null, workerId: null, startedAt: null, finishedAt: null, failureReason: null, approvalRef: null, reconciledOnce: false, result: null };
    part.jobs.set(jobId, job);
    emit(part, 'workflow.job.queued', { jobId }, nowIso());
    return { duplicate: false, job: getJob(tenantId, jobId) };
  }

  function getJob(tenantId, jobId) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job) throw new Error('job not found');
    return Object.freeze({ ...job });
  }

  function mutateJob(tenantId, jobId, mutator) {
    const part = partition(state, tenantId);
    const current = part.jobs.get(jobId);
    if (!current) throw new Error('job not found');
    part.jobs.set(jobId, mutator(current));
    return getJob(tenantId, jobId);
  }

  function claimJob({ workerId }) {
    const normalizedWorker = required(workerId, 'workerId');
    const now = clock();
    for (const [tenantId, part] of state.tenants) {
      for (const job of part.jobs.values()) {
        if (job.state !== 'queued') continue;
        if (job.backoffAt && new Date(job.backoffAt).getTime() > now) continue;
        if (job.requiresApproval) {
          const approval = job.approvalRef ? part.approvals.get(job.approvalRef) : null;
          try {
            requireValidApproval({ job, approval, now: new Date(now) });
          } catch {
            continue;
          }
        }
        const claimed = mutateJob(tenantId, job.jobId, (j) => ({ ...transitionJob(j, 'running'), workerId: normalizedWorker, startedAt: nowIso() }));
        emit(part, 'workflow.job.running', { jobId: job.jobId, workerId: normalizedWorker }, nowIso());
        return claimed;
      }
    }
    return null;
  }

  function completeJob(tenantId, jobId, { result } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job) throw new Error('job not found');
    if (job.state !== 'running') throw new Error(`cannot complete job in state ${job.state}`);
    const updated = mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'succeeded'), result: result == null ? null : structuredClone(result), finishedAt: nowIso() }));
    emit(part, 'workflow.job.succeeded', { jobId }, nowIso());
    return updated;
  }

  function failJob(tenantId, jobId, { error } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job) throw new Error('job not found');
    if (job.state !== 'running') throw new Error(`cannot fail job in state ${job.state}`);
    const attemptsAfterFailure = job.attempts;
    if (attemptsAfterFailure >= maxAttempts) {
      const updated = mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'failed'), failureReason: String(error ?? 'unknown') }));
      mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'dead_letter'), finishedAt: nowIso() }));
      part.deadLetters.push(getJob(tenantId, jobId));
      emit(part, 'workflow.job.dead_letter', { jobId, reason: String(error ?? 'unknown') }, nowIso());
      return getJob(tenantId, jobId);
    }
    const delayMs = 2 ** attemptsAfterFailure * 1000;
    const backoffAt = new Date(clock() + delayMs).toISOString();
    const updated = mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'failed'), failureReason: String(error ?? 'unknown'), backoffAt }));
    emit(part, 'workflow.job.failed', { jobId, attempt: attemptsAfterFailure, retryAt: backoffAt }, nowIso());
    mutateJob(tenantId, jobId, (j) => transitionJob(j, 'queued'));
    emit(part, 'workflow.job.queued', { jobId, retried: true }, nowIso());
    return updated;
  }

  function cancelJob(tenantId, jobId, { actor, reason } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job) throw new Error('job not found');
    required(actor, 'actor');
    if (!['queued', 'running', 'waiting_approval'].includes(job.state)) throw new Error(`cannot cancel job in state ${job.state}`);
    if (job.state === 'running') {
      const updated = mutateJob(tenantId, jobId, (j) => ({ ...j, cancelRequestedBy: String(actor), cancelReason: String(reason ?? ''), pendingState: 'cancelled' }));
      emit(part, 'workflow.job.cancelling', { jobId, actor }, nowIso());
      return updated;
    }
    const updated = mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'cancelled'), finishedAt: nowIso(), failureReason: `cancelled by ${actor}: ${String(reason ?? '')}` }));
    emit(part, 'workflow.job.cancelled', { jobId, actor }, nowIso());
    return updated;
  }

  function confirmCancel(tenantId, jobId) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job || job.state !== 'running' || job.pendingState !== 'cancelled') throw new Error('no pending cancellation');
    const updated = mutateJob(tenantId, jobId, (j) => ({ ...transitionJob(j, 'cancelled'), finishedAt: nowIso() }));
    emit(part, 'workflow.job.cancelled', { jobId }, nowIso());
    return updated;
  }

  function requestApproval(tenantId, jobId, { actor, action, resource } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const job = part.jobs.get(required(jobId, 'jobId'));
    if (!job) throw new Error('job not found');
    if (job.state !== 'running' && job.state !== 'queued') throw new Error(`cannot request approval in state ${job.state}`);
    const approvalId = `appr_${randomUUID()}`;
    const expiresAt = new Date(clock() + approvalTtlMs).toISOString();
    const requestedBy = required(actor, 'actor');
    const approval = createApproval({ tenantId, approvalId, job: { ...job, requiresApproval: true }, approverId: requestedBy, decision: 'approved', expiresAt, decidedAt: expiresAt });
    const bound = Object.freeze({ ...approval, decision: 'pending', requestedBy, action: String(action || job.action), resourceId: String(resource || job.resourceId), requestedAt: nowIso() });
    part.approvals.set(approvalId, bound);
    mutateJob(tenantId, jobId, (j) => j.state === 'running' ? { ...transitionJob(j, 'waiting_approval'), approvalRef: approvalId } : { ...j, approvalRef: approvalId });
    emit(part, 'workflow.job.waiting_approval', { jobId, approvalId, phase: job.state === 'running' ? 'suspended' : 'pre_claim' }, nowIso());
    return Object.freeze({ ...bound });
  }

  function decideApproval(tenantId, approvalId, { decision, actor } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    const approval = part.approvals.get(required(approvalId, 'approvalId'));
    if (!approval) throw new Error('approval not found');
    required(actor, 'actor');
    const normalizedDecision = String(decision || '').toLowerCase();
    if (!['approve', 'reject'].includes(normalizedDecision)) throw new Error('decision must be approve or reject');
    if (new Date(approval.expiresAt).getTime() <= clock()) {
      throw Object.assign(new Error('approval expired'), { code: 'APPROVAL_EXPIRED' });
    }
    const finalDecision = normalizedDecision === 'approve' ? 'approved' : 'rejected';
    part.approvals.set(approvalId, Object.freeze({ ...approval, decision: finalDecision, approverId: String(actor), decidedAt: nowIso() }));
    const job = part.jobs.get(approval.jobId);
    if (job) {
      if (finalDecision === 'rejected') {
        if (job.state === 'waiting_approval') {
          mutateJob(tenantId, job.jobId, (j) => ({ ...transitionJob(j, 'failed'), failureReason: 'approval rejected', finishedAt: nowIso() }));
        } else if (job.state === 'queued') {
          mutateJob(tenantId, job.jobId, (j) => ({ ...transitionJob(j, 'cancelled'), finishedAt: nowIso(), failureReason: 'approval rejected before execution' }));
        }
        emit(part, 'workflow.job.rejected', { jobId: job.jobId, approvalId }, nowIso());
      } else if (finalDecision === 'approved') {
        if (job.state === 'waiting_approval') {
          mutateJob(tenantId, job.jobId, (j) => ({ ...transitionJob(j, 'running'), backoffAt: null }));
          emit(part, 'workflow.job.approved_resumed', { jobId: job.jobId, approvedBy: String(actor) }, nowIso());
        } else {
          emit(part, 'workflow.job.approved_pre_claim', { jobId: job.jobId, approvedBy: String(actor) }, nowIso());
        }
      }
    }
    return part.approvals.get(approvalId);
  }

  function reconcile({ staleThresholdMs } = {}) {
    const threshold = Number.isFinite(staleThresholdMs) ? staleThresholdMs : staleRunningMs;
    const now = clock();
    const requeued = [];
    for (const [tenantId, part] of state.tenants) {
      for (const job of part.jobs.values()) {
        if (job.state !== 'running' || job.reconciledOnce) continue;
        const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : 0;
        if (now - startedAt <= threshold) continue;
        mutateJob(tenantId, job.jobId, (j) => ({ ...transitionJob(j, 'failed'), failureReason: 'stale running job requeued by reconciliation', reconciledOnce: true }));
        mutateJob(tenantId, job.jobId, (j) => transitionJob(j, 'queued'));
        emit(part, 'workflow.reconciliation.requeued', { jobId: job.jobId }, nowIso());
        requeued.push(getJob(tenantId, job.jobId));
      }
    }
    return requeued;
  }

  function listDeadLetters(tenantId) {
    const part = partition(state, required(tenantId, 'tenantId'));
    return Object.freeze(part.deadLetters.map((job) => Object.freeze({ ...job })));
  }

  function listOutbox(tenantId) {
    const part = partition(state, required(tenantId, 'tenantId'));
    return Object.freeze(part.outbox.map((event) => Object.freeze({ ...event })));
  }

  function listJobs(tenantId) {
    const part = partition(state, required(tenantId, 'tenantId'));
    return Object.freeze([...part.jobs.values()].map((job) => Object.freeze({ ...job })));
  }

  function drainOutbox(tenantId, { limit = 100 } = {}) {
    const part = partition(state, required(tenantId, 'tenantId'));
    return part.outbox.splice(0, Math.max(1, Math.floor(limit)));
  }

  return Object.freeze({
    registerToolGrant,
    enqueueJob,
    getJob,
    listJobs,
    claimJob,
    completeJob,
    failJob,
    cancelJob,
    confirmCancel,
    requestApproval,
    decideApproval,
    reconcile,
    listDeadLetters,
    listOutbox,
    drainOutbox
  });
}

export { JobStates };
