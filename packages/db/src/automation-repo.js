function required(value, name) {
  const t = String(value ?? '').trim();
  if (!t) throw new Error(`${name} is required`);
  return t;
}
const MODES = new Set(['manual','assisted','draft_only','approval_required','auto_safe','autonomous']);
const SCOPES = new Set(['global','org','provider','account','campaign','workflow']);

function rows(result) { return Array.isArray(result?.rows) ? result.rows : []; }

export function createAutomationRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');

  async function inTenant(rawTenantId, fn) {
    const tid = required(rawTenantId, 'tenantId').toLowerCase();
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tid]);
      return fn(tx, tid);
    });
  }

  async function getPolicy({ tenantId } = {}) {
    return inTenant(tenantId, async (tx, tid) => {
      const r = await tx.query('SELECT * FROM automation_policies WHERE tenant_id=$1', [tid]);
      const row = rows(r)[0];
      if (!row) return null;
      return Object.freeze({ tenantId: row.tenant_id, mode: row.mode, allowAutoPublish: row.allow_auto_publish, policyVersion: row.policy_version, payload: row.payload ?? {}, updatedAt: new Date(row.updated_at).toISOString() });
    });
  }

  async function upsertPolicy({ tenantId, mode = 'manual', allowAutoPublish = false, payload = {} } = {}) {
    if (!MODES.has(String(mode).toLowerCase())) throw new Error(`unsupported automation mode: ${mode}`);
    return inTenant(tenantId, async (tx, tid) => {
      const normalized = String(mode).toLowerCase();
      const r = await tx.query(
        `INSERT INTO automation_policies (tenant_id, mode, allow_auto_publish, payload, policy_version, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,'v1',now())
         ON CONFLICT (tenant_id) DO UPDATE SET mode=EXCLUDED.mode, allow_auto_publish=EXCLUDED.allow_auto_publish, payload=EXCLUDED.payload, updated_at=now()
         RETURNING *`,
        [tid, normalized, Boolean(allowAutoPublish), JSON.stringify(payload ?? {})]
      );
      const row = rows(r)[0];
      return Object.freeze({ tenantId: row.tenant_id, mode: row.mode, allowAutoPublish: row.allow_auto_publish, policyVersion: row.policy_version, updatedAt: new Date(row.updated_at).toISOString() });
    });
  }

  async function listKillSwitches({ tenantId } = {}) {
    return inTenant(tenantId, async (tx, tid) => {
      const r = await tx.query('SELECT * FROM automation_kill_switches WHERE tenant_id=$1 AND active=true ORDER BY set_at DESC', [tid]);
      return Object.freeze(rows(r).map((row) => Object.freeze({ id: row.id, tenantId: row.tenant_id, scope: row.scope, targetId: row.target_id, active: row.active, reason: row.reason, actorId: row.actor_id, setAt: new Date(row.set_at).toISOString() })));
    });
  }

  async function setKillSwitch({ tenantId, scope, targetId = null, reason = '', actorId = null, active = true } = {}) {
    const normalizedScope = String(scope ?? '').trim().toLowerCase();
    if (!SCOPES.has(normalizedScope)) throw new Error(`unsupported kill switch scope: ${scope}`);
    return inTenant(tenantId, async (tx, tid) => {
      if (active) {
        const r = await tx.query(
          `INSERT INTO automation_kill_switches (tenant_id, scope, target_id, reason, actor_id, active)
           VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
          [tid, normalizedScope, targetId ? String(targetId) : null, String(reason ?? ''), actorId ? String(actorId) : null]
        );
        const row = rows(r)[0];
        return Object.freeze({ id: row.id, scope: row.scope, targetId: row.target_id, active: row.active, reason: row.reason, setAt: new Date(row.set_at).toISOString() });
      }
      await tx.query(
        `UPDATE automation_kill_switches SET active=false, cleared_at=now() WHERE tenant_id=$1 AND scope=$2 AND ($3::text IS NULL OR target_id=$3) AND active=true`,
        [tid, normalizedScope, targetId ? String(targetId) : null]
      );
      return Object.freeze({ cleared: true, scope: normalizedScope, targetId });
    });
  }

  return Object.freeze({ getPolicy, upsertPolicy, listKillSwitches, setKillSwitch });
}
