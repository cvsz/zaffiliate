const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function tenantId(value) {
  const id = required(value, 'tenantId');
  if (!UUID_PATTERN.test(id)) throw new Error('tenantId must be a UUID');
  return id;
}

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function setTenant(tx, id) {
  await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
}

export function createOutboxRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction() is required');

  async function inTenant(rawTenantId, fn) {
    const id = tenantId(rawTenantId);
    return db.transaction(async (tx) => {
      await setTenant(tx, id);
      return fn(tx, id);
    });
  }

  async function claimOutbox(rawTenantId, { limit = 50, workerId = `worker-${process.pid}`, leaseMs = 30_000 } = {}) {
    const batch = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const worker = required(workerId, 'workerId');
    const lease = Math.max(Number(leaseMs) || 30_000, 1_000);
    return inTenant(rawTenantId, async (tx, id) => {
      const result = await tx.query(
        `WITH candidates AS (
           SELECT id FROM affiliate_domain_outbox
           WHERE tenant_id = $1
             AND dispatched_at IS NULL
             AND available_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - ($4::bigint * interval '1 millisecond'))
           ORDER BY created_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE affiliate_domain_outbox o
         SET locked_at = now(), locked_by = $3, attempts = attempts + 1, last_error = NULL
         FROM candidates c
         WHERE o.id = c.id
         RETURNING o.*`,
        [id, batch, worker, lease]
      );
      return Object.freeze(rows(result).map((row) => Object.freeze({
        id: row.id,
        eventId: row.event_id,
        tenantId: row.tenant_id,
        type: row.event_type,
        payload: Object.freeze(row.payload ?? {}),
        occurredAt: new Date(row.occurred_at).toISOString(),
        attempts: Number(row.attempts)
      })));
    });
  }

  async function markOutboxDispatched(rawTenantId, eventId) {
    return inTenant(rawTenantId, async (tx, id) => {
      const result = await tx.query(
        `UPDATE affiliate_domain_outbox
         SET dispatched_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
         WHERE tenant_id = $1 AND event_id = $2 AND dispatched_at IS NULL
         RETURNING event_id`,
        [id, required(eventId, 'eventId')]
      );
      return rows(result).length === 1;
    });
  }

  async function releaseOutbox(rawTenantId, eventId, error, { retryDelayMs = 1_000 } = {}) {
    const delay = Math.max(Number(retryDelayMs) || 1_000, 0);
    return inTenant(rawTenantId, async (tx, id) => {
      const result = await tx.query(
        `UPDATE affiliate_domain_outbox
         SET locked_at = NULL, locked_by = NULL, last_error = $3,
             available_at = now() + ($4::bigint * interval '1 millisecond')
         WHERE tenant_id = $1 AND event_id = $2 AND dispatched_at IS NULL
         RETURNING event_id`,
        [id, required(eventId, 'eventId'), String(error instanceof Error ? error.message : error).slice(0, 1000), delay]
      );
      return rows(result).length === 1;
    });
  }

  return Object.freeze({ claimOutbox, markOutboxDispatched, releaseOutbox });
}
