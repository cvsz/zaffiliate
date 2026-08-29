const PUBLICATION_STATUSES = Object.freeze([
  'draft', 'waiting_approval', 'approved', 'scheduled', 'processing', 'published', 'partial', 'failed', 'cancelled'
]);

const TERMINAL_STATUSES = Object.freeze(['published', 'cancelled']);

const TRANSITIONS = Object.freeze({
  draft: Object.freeze(['waiting_approval', 'approved', 'cancelled']),
  waiting_approval: Object.freeze(['approved', 'cancelled']),
  approved: Object.freeze(['scheduled', 'processing', 'cancelled']),
  scheduled: Object.freeze(['processing', 'cancelled']),
  processing: Object.freeze(['published', 'partial', 'failed']),
  partial: Object.freeze(['processing', 'scheduled', 'cancelled']),
  failed: Object.freeze(['processing', 'scheduled', 'cancelled']),
  published: Object.freeze([]),
  cancelled: Object.freeze([])
});

export class PublicationTransitionError extends Error {
  constructor(fromStatus, toStatus) {
    super(`illegal publication job transition ${fromStatus} -> ${toStatus}`);
    this.name = 'PublicationTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    this.code = 'PUBLICATION_TRANSITION_ILLEGAL';
  }
}

function requireText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function requireStatus(value, label = 'status') {
  const status = String(value ?? '').trim();
  if (!PUBLICATION_STATUSES.includes(status)) throw new Error(`${label} must be one of ${PUBLICATION_STATUSES.join('|')}`);
  return status;
}

function rowToJob(row) {
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    jobId: row.id,
    contentItemId: row.content_item_id,
    platform: row.platform,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    nextRetryAt: row.next_retry_at,
    providerResponse: row.provider_response,
    externalContentId: row.external_content_id,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createPublicationJobsRepo(client) {
  if (!client || typeof client.query !== 'function') throw new TypeError('client with query is required');

  async function create(tenantId, input) {
    const tenant = requireText(tenantId, 'tenantId');
    if (input == null || typeof input !== 'object') throw new TypeError('job input is required');
    const platform = requireText(input.platform, 'platform');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const status = requireStatus(input.status ?? 'draft');
    if (TERMINAL_STATUSES.includes(status)) throw new Error('a publication job cannot be created in a terminal status');
    const maxAttempts = Math.floor(Number(input.maxAttempts ?? 3));
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer');
    const result = await client.query(
      `INSERT INTO publication_jobs
        (tenant_id, content_item_id, platform, status, idempotency_key, attempt, max_attempts, next_retry_at, provider_response, external_content_id, failure_code, failure_reason, scheduled_for)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8::jsonb, $9, $10, $11, $12)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        tenant,
        input.contentItemId ?? null,
        platform,
        status,
        idempotencyKey,
        maxAttempts,
        input.nextRetryAt ?? null,
        input.providerResponse == null ? null : JSON.stringify(input.providerResponse),
        input.externalContentId ?? null,
        input.failureCode ?? null,
        input.failureReason ?? null,
        input.scheduledFor ?? null
      ]
    );
    if ((result.rows ?? []).length > 0) {
      return { created: true, duplicate: false, job: rowToJob(result.rows[0]) };
    }
    const existing = await client.query(
      'SELECT * FROM publication_jobs WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1',
      [tenant, idempotencyKey]
    );
    return { created: false, duplicate: true, job: rowToJob((existing.rows ?? [])[0]) };
  }

  async function transition(tenantId, jobId, toStatus, patch = {}) {
    const tenant = requireText(tenantId, 'tenantId');
    const id = requireText(jobId, 'jobId');
    const target = requireStatus(toStatus);
    const currentResult = await client.query(
      'SELECT * FROM publication_jobs WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
      [tenant, id]
    );
    const currentRow = (currentResult.rows ?? [])[0];
    if (!currentRow) return { transitioned: false, reason: 'not_found' };
    const fromStatus = currentRow.status;
    if (!(TRANSITIONS[fromStatus] ?? []).includes(target)) {
      throw new PublicationTransitionError(fromStatus, target);
    }
    if (['partial', 'failed'].includes(fromStatus) && target === 'processing' && Number(currentRow.attempt) >= Number(currentRow.max_attempts)) {
      return { transitioned: false, reason: 'retry_budget_exhausted', attemptsUsed: Number(currentRow.attempt), maxAttempts: Number(currentRow.max_attempts) };
    }
    const updated = await client.query(
      `UPDATE publication_jobs SET
        status = $3,
        attempt = CASE WHEN $3 = 'processing' THEN attempt + 1 ELSE attempt END,
        provider_response = COALESCE($4::jsonb, provider_response),
        external_content_id = COALESCE($5, external_content_id),
        failure_code = $6,
        failure_reason = $7,
        scheduled_for = COALESCE($8, scheduled_for),
        next_retry_at = COALESCE($9, next_retry_at),
        updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = $10
       RETURNING *`,
      [
        tenant,
        id,
        target,
        patch.providerResponse == null ? null : JSON.stringify(patch.providerResponse),
        patch.externalContentId ?? null,
        patch.failureCode ?? null,
        patch.failureReason ?? null,
        patch.scheduledFor ?? null,
        patch.nextRetryAt ?? null,
        fromStatus
      ]
    );
    if ((updated.rows ?? []).length === 0) {
      return { transitioned: false, reason: 'status_changed_concurrently', previousStatus: fromStatus };
    }
    return { transitioned: true, job: rowToJob(updated.rows[0]) };
  }

  async function claimDue(tenantId, nowIso, limit = 10) {
    const tenant = requireText(tenantId, 'tenantId');
    const now = requireText(nowIso, 'nowIso');
    const capped = Math.max(1, Math.min(Number(limit) || 10, 100));
    const result = await client.query(
      `UPDATE publication_jobs SET
        status = 'processing',
        attempt = attempt + 1,
        updated_at = now()
       WHERE id IN (
         SELECT id FROM publication_jobs
         WHERE tenant_id = $1
           AND (
             (status = 'scheduled' AND (scheduled_for IS NULL OR scheduled_for <= $2::timestamptz))
             OR (status IN ('failed','partial') AND (next_retry_at IS NULL OR next_retry_at <= $2::timestamptz))
           )
           AND attempt < max_attempts
         ORDER BY COALESCE(next_retry_at, scheduled_for, created_at)
         LIMIT $3
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [tenant, now, capped]
    );
    return (result.rows ?? []).map(rowToJob);
  }

  async function getById(tenantId, jobId) {
    const result = await client.query(
      'SELECT * FROM publication_jobs WHERE tenant_id = $1 AND id = $2 LIMIT 1',
      [requireText(tenantId, 'tenantId'), requireText(jobId, 'jobId')]
    );
    return rowToJob((result.rows ?? [])[0]);
  }

  async function listByStatus(tenantId, status, limit = 50) {
    const tenant = requireText(tenantId, 'tenantId');
    const validated = requireStatus(status);
    const capped = Math.max(1, Math.min(Number(limit) || 50, 500));
    const result = await client.query(
      'SELECT * FROM publication_jobs WHERE tenant_id = $1 AND status = $2 ORDER BY COALESCE(scheduled_for, created_at) LIMIT $3',
      [tenant, validated, capped]
    );
    return (result.rows ?? []).map(rowToJob);
  }

  return Object.freeze({ create, transition, claimDue, getById, listByStatus });
}
