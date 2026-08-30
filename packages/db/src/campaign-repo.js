import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['draft', 'active', 'paused', 'completed', 'cancelled']);
const TRANSITIONS = Object.freeze({
  draft: new Set(['active', 'cancelled']),
  active: new Set(['paused', 'completed', 'cancelled']),
  paused: new Set(['active', 'completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set()
});

export class CampaignNotFoundError extends Error {
  constructor() {
    super('campaign not found');
    this.name = 'CampaignNotFoundError';
    this.code = 'CAMPAIGN_NOT_FOUND';
  }
}

export class CampaignTransitionError extends Error {
  constructor(from, to) {
    super(`campaign cannot transition from ${from} to ${to}`);
    this.name = 'CampaignTransitionError';
    this.code = 'CAMPAIGN_TRANSITION_INVALID';
    this.from = from;
    this.to = to;
  }
}

export class CampaignConflictError extends Error {
  constructor(message = 'campaign already exists') {
    super(message);
    this.name = 'CampaignConflictError';
    this.code = 'CAMPAIGN_CONFLICT';
  }
}

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function uuid(value, name) {
  const text = required(value, name).toLowerCase();
  if (!UUID_PATTERN.test(text)) throw new Error(`${name} must be a UUID`);
  return text;
}

function campaignName(value) {
  const text = required(value, 'name');
  if (text.length > 255) throw new Error('name must be at most 255 characters');
  return text;
}

function objective(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (text.length > 500) throw new Error('objective must be at most 500 characters');
  return text;
}

function budget(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) throw new Error('budgetLimit must be a non-negative decimal with at most 6 fractional digits');
  const [whole] = text.split('.');
  if (whole.length > 14) throw new Error('budgetLimit exceeds numeric(20,6)');
  return text;
}

function status(value) {
  const text = required(value, 'status').toLowerCase();
  if (!STATUSES.has(text)) throw new Error('invalid campaign status');
  return text;
}

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function mapCampaign(row) {
  if (!row) return null;
  return Object.freeze({
    tenantId: row.tenant_id,
    campaignId: row.id,
    name: row.name,
    status: row.status,
    objective: row.objective ?? null,
    budgetLimit: row.budget_limit == null ? null : String(row.budget_limit),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  });
}

export function createCampaignRepo({ db, clock = () => Date.now() } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  async function setTenant(tx, tenantId) {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  async function inTenant(rawTenantId, fn) {
    const tenantId = uuid(rawTenantId, 'tenantId');
    return db.transaction(async (tx) => {
      await setTenant(tx, tenantId);
      return fn(tx, tenantId);
    });
  }

  async function audit(tx, { tenantId, actorId, action, campaignId, reason, payload = {} }) {
    await tx.query(
      `INSERT INTO audit_events
        (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
       VALUES ($1,$2,$3,'campaign',$4,'allowed',$5,$6::jsonb)`,
      [tenantId, required(actorId, 'actorId'), action, campaignId, reason, JSON.stringify(payload)]
    );
  }

  async function enqueue(tx, { tenantId, type, campaignId, payload = {} }) {
    const eventId = `evt_${randomUUID()}`;
    const occurredAt = new Date(clock()).toISOString();
    await tx.query(
      `INSERT INTO affiliate_domain_outbox (tenant_id, event_id, event_type, payload, occurred_at)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [tenantId, eventId, type, JSON.stringify({ campaignId, ...payload }), occurredAt]
    );
  }

  async function createCampaign({ tenantId, actorId, name, objective: rawObjective = null, budgetLimit = null } = {}) {
    return inTenant(tenantId, async (tx, scopedTenant) => {
      let result;
      try {
        result = await tx.query(
          `INSERT INTO campaigns (tenant_id, name, objective, budget_limit)
           VALUES ($1,$2,$3,$4)
           RETURNING *`,
          [scopedTenant, campaignName(name), objective(rawObjective), budget(budgetLimit)]
        );
      } catch (error) {
        if (String(error?.code ?? '') === '23505') throw new CampaignConflictError();
        throw error;
      }
      const campaign = mapCampaign(rows(result)[0]);
      await audit(tx, {
        tenantId: scopedTenant,
        actorId,
        action: 'campaign.created',
        campaignId: campaign.campaignId,
        reason: 'campaign created',
        payload: { status: campaign.status }
      });
      await enqueue(tx, { tenantId: scopedTenant, type: 'campaign.created', campaignId: campaign.campaignId, payload: { status: campaign.status } });
      return campaign;
    });
  }

  async function getCampaign({ tenantId, campaignId } = {}) {
    return inTenant(tenantId, async (tx, scopedTenant) => {
      const result = await tx.query('SELECT * FROM campaigns WHERE tenant_id=$1 AND id=$2', [scopedTenant, uuid(campaignId, 'campaignId')]);
      return mapCampaign(rows(result)[0]);
    });
  }

  async function listCampaigns({ tenantId, status: rawStatus = null, limit = 100 } = {}) {
    const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const filter = rawStatus == null || rawStatus === '' ? null : status(rawStatus);
    return inTenant(tenantId, async (tx, scopedTenant) => {
      const result = filter
        ? await tx.query('SELECT * FROM campaigns WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT $3', [scopedTenant, filter, boundedLimit])
        : await tx.query('SELECT * FROM campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2', [scopedTenant, boundedLimit]);
      return Object.freeze(rows(result).map(mapCampaign));
    });
  }

  async function updateCampaign({ tenantId, actorId, campaignId, name, objective: rawObjective, budgetLimit } = {}) {
    const id = uuid(campaignId, 'campaignId');
    const hasName = name !== undefined;
    const hasObjective = rawObjective !== undefined;
    const hasBudget = budgetLimit !== undefined;
    if (!hasName && !hasObjective && !hasBudget) throw new Error('at least one campaign field is required');
    return inTenant(tenantId, async (tx, scopedTenant) => {
      const current = rows(await tx.query('SELECT * FROM campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [scopedTenant, id]))[0];
      if (!current) throw new CampaignNotFoundError();
      let result;
      try {
        result = await tx.query(
          `UPDATE campaigns
           SET name=$3, objective=$4, budget_limit=$5, updated_at=now()
           WHERE tenant_id=$1 AND id=$2
           RETURNING *`,
          [
            scopedTenant,
            id,
            hasName ? campaignName(name) : current.name,
            hasObjective ? objective(rawObjective) : current.objective,
            hasBudget ? budget(budgetLimit) : current.budget_limit
          ]
        );
      } catch (error) {
        if (String(error?.code ?? '') === '23505') throw new CampaignConflictError();
        throw error;
      }
      const campaign = mapCampaign(rows(result)[0]);
      await audit(tx, {
        tenantId: scopedTenant,
        actorId,
        action: 'campaign.updated',
        campaignId: id,
        reason: 'campaign metadata updated'
      });
      await enqueue(tx, { tenantId: scopedTenant, type: 'campaign.updated', campaignId: id });
      return campaign;
    });
  }

  async function transitionCampaign({ tenantId, actorId, campaignId, to } = {}) {
    const id = uuid(campaignId, 'campaignId');
    const target = status(to);
    return inTenant(tenantId, async (tx, scopedTenant) => {
      const current = rows(await tx.query('SELECT * FROM campaigns WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [scopedTenant, id]))[0];
      if (!current) throw new CampaignNotFoundError();
      if (!TRANSITIONS[current.status]?.has(target)) throw new CampaignTransitionError(current.status, target);
      const result = await tx.query(
        `UPDATE campaigns SET status=$3, updated_at=now()
         WHERE tenant_id=$1 AND id=$2
         RETURNING *`,
        [scopedTenant, id, target]
      );
      const campaign = mapCampaign(rows(result)[0]);
      await audit(tx, {
        tenantId: scopedTenant,
        actorId,
        action: 'campaign.status_changed',
        campaignId: id,
        reason: 'campaign lifecycle transition',
        payload: { from: current.status, to: target }
      });
      await enqueue(tx, {
        tenantId: scopedTenant,
        type: 'campaign.status_changed',
        campaignId: id,
        payload: { from: current.status, to: target }
      });
      return campaign;
    });
  }

  return Object.freeze({ createCampaign, getCampaign, listCampaigns, updateCampaign, transitionCampaign });
}
