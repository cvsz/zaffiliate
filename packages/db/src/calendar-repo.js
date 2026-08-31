function required(value, name) {
  const t = String(value ?? '').trim();
  if (!t) throw new Error(`${name} is required`);
  return t;
}
const KINDS = new Set(['campaign','content','publish','meeting']);

export function createCalendarRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');
  async function inTenant(rawTenantId, fn) {
    const tid = required(rawTenantId, 'tenantId').toLowerCase();
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tid]);
      return fn(tx, tid);
    });
  }
  async function create({ tenantId, title, kind = 'content', startsAt, endsAt = null, payload = {} } = {}) {
    if (!KINDS.has(String(kind).toLowerCase())) throw new Error(`unsupported calendar kind: ${kind}`);
    return inTenant(tenantId, async (tx, tid) => {
      const r = await tx.query(
        `INSERT INTO calendar_events (tenant_id, title, kind, starts_at, ends_at, payload)
         VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::jsonb) RETURNING *`,
        [tid, required(title, 'title'), String(kind).toLowerCase(), required(startsAt, 'startsAt'), endsAt, JSON.stringify(payload ?? {})]
      );
      const row = (r.rows || [])[0];
      return Object.freeze({ id: row.id, tenantId: row.tenant_id, title: row.title, kind: row.kind, startsAt: new Date(row.starts_at).toISOString(), endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null });
    });
  }
  async function list({ tenantId, from = null, to = null, limit = 50 } = {}) {
    return inTenant(tenantId, async (tx, tid) => {
      const capped = Math.max(1, Math.min(Number(limit) || 50, 200));
      const r = await tx.query(
        `SELECT * FROM calendar_events WHERE tenant_id=$1
         AND ($2::timestamptz IS NULL OR starts_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR starts_at <= $3::timestamptz)
         ORDER BY starts_at LIMIT $4`,
        [tid, from, to, capped]
      );
      return Object.freeze((r.rows || []).map((row) => Object.freeze({ id: row.id, tenantId: row.tenant_id, title: row.title, kind: row.kind, startsAt: new Date(row.starts_at).toISOString(), endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null })));
    });
  }
  async function get({ tenantId, id } = {}) {
    return inTenant(tenantId, async (tx, tid) => {
      const r = await tx.query('SELECT * FROM calendar_events WHERE tenant_id=$1 AND id=$2 LIMIT 1', [tid, required(id, 'id')]);
      const row = (r.rows || [])[0];
      return row ? Object.freeze({ id: row.id, tenantId: row.tenant_id, title: row.title, kind: row.kind, startsAt: new Date(row.starts_at).toISOString(), endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null }) : null;
    });
  }
  return Object.freeze({ create, list, get });
}
