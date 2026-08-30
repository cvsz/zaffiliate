import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSION_ID_PATTERN = /^cnv_[A-Za-z0-9_-]{1,160}$/;
const STATUSES = new Set(['pending', 'confirmed', 'refunded', 'rejected']);

export class ConversionNotFoundError extends Error {
  constructor() {
    super('conversion not found');
    this.name = 'ConversionNotFoundError';
    this.code = 'CONVERSION_NOT_FOUND';
  }
}

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function tenantId(value) {
  const text = required(value, 'tenantId').toLowerCase();
  if (!UUID_PATTERN.test(text)) throw new Error('tenantId must be a UUID');
  return text;
}

function conversionId(value) {
  const text = required(value, 'conversionId');
  if (!CONVERSION_ID_PATTERN.test(text)) throw new Error('conversionId must be a valid runtime conversion id');
  return text;
}

function status(value) {
  const text = required(value, 'status').toLowerCase();
  if (!STATUSES.has(text)) throw new Error('invalid conversion status');
  return text;
}

function optionalTimestamp(value, name) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

function mapConversion(row) {
  if (!row) return null;
  return Object.freeze({
    tenantId: row.tenant_id,
    conversionId: row.runtime_id,
    linkId: row.link_runtime_id,
    offerId: row.offer_runtime_id,
    productId: row.product_runtime_id,
    orderRef: row.external_order_id,
    revenueMinorUnits: row.revenue_minor_units == null ? null : Number(row.revenue_minor_units),
    currency: row.currency,
    commissionRate: row.commission_rate == null ? null : Number(row.commission_rate),
    grossCommissionMinorUnits: row.gross_commission_minor_units == null ? null : Number(row.gross_commission_minor_units),
    status: row.status,
    occurredAt: new Date(row.occurred_at).toISOString(),
    recordedAt: new Date(row.created_at).toISOString(),
    statusUpdatedAt: new Date(row.status_updated_at).toISOString()
  });
}

const SELECT_CONVERSION = `
  SELECT c.*, l.runtime_id AS link_runtime_id,
         o.runtime_id AS offer_runtime_id, p.runtime_id AS product_runtime_id
  FROM conversions c
  JOIN affiliate_links l ON l.id = c.affiliate_link_id AND l.tenant_id = c.tenant_id
  JOIN offers o ON o.id = c.offer_id AND o.tenant_id = c.tenant_id
  JOIN products p ON p.id = o.product_id AND p.tenant_id = c.tenant_id
`;

export function createConversionReconciliationRepo({ db, clock = () => Date.now() } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  async function inTenant(rawTenantId, fn) {
    const scopedTenant = tenantId(rawTenantId);
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [scopedTenant]);
      return fn(tx, scopedTenant);
    });
  }

  async function getConversion({ tenantId: rawTenantId, conversionId: rawConversionId } = {}) {
    const id = conversionId(rawConversionId);
    return inTenant(rawTenantId, async (tx, scopedTenant) => {
      const result = await tx.query(`${SELECT_CONVERSION} WHERE c.tenant_id=$1 AND c.runtime_id=$2 LIMIT 1`, [scopedTenant, id]);
      return mapConversion(rows(result)[0]);
    });
  }

  async function listConversions({ tenantId: rawTenantId, from = null, to = null, status: rawStatus = null, limit = 100 } = {}) {
    const fromIso = optionalTimestamp(from, 'from');
    const toIso = optionalTimestamp(to, 'to');
    if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) throw new Error('from must be before or equal to to');
    const filterStatus = rawStatus == null || rawStatus === '' ? null : status(rawStatus);
    const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    return inTenant(rawTenantId, async (tx, scopedTenant) => {
      const result = await tx.query(
        `${SELECT_CONVERSION}
         WHERE c.tenant_id=$1
           AND ($2::timestamptz IS NULL OR c.occurred_at >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR c.occurred_at <= $3::timestamptz)
           AND ($4::text IS NULL OR c.status = $4::text)
         ORDER BY c.occurred_at DESC, c.id DESC
         LIMIT $5`,
        [scopedTenant, fromIso, toIso, filterStatus, boundedLimit]
      );
      return Object.freeze(rows(result).map(mapConversion));
    });
  }

  async function aggregateCommission({ tenantId: rawTenantId, from = null, to = null, status: rawStatus = null } = {}) {
    const fromIso = optionalTimestamp(from, 'from');
    const toIso = optionalTimestamp(to, 'to');
    if (fromIso && toIso && new Date(fromIso) > new Date(toIso)) throw new Error('from must be before or equal to to');
    const filterStatus = rawStatus == null || rawStatus === '' ? null : status(rawStatus);
    return inTenant(rawTenantId, async (tx, scopedTenant) => {
      const result = await tx.query(
        `SELECT status, currency, COUNT(*)::int AS count,
                COALESCE(SUM(revenue_minor_units), 0)::text AS total_revenue_minor_units,
                COALESCE(SUM(gross_commission_minor_units), 0)::text AS total_gross_commission_minor_units
         FROM conversions
         WHERE tenant_id=$1
           AND ($2::timestamptz IS NULL OR occurred_at >= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR occurred_at <= $3::timestamptz)
           AND ($4::text IS NULL OR status = $4::text)
         GROUP BY status, currency
         ORDER BY currency, status`,
        [scopedTenant, fromIso, toIso, filterStatus]
      );
      return Object.freeze(rows(result).map((row) => Object.freeze({
        status: status(row.status),
        currency: row.currency,
        count: Number(row.count),
        totalRevenueMinorUnits: String(row.total_revenue_minor_units),
        totalGrossCommissionMinorUnits: String(row.total_gross_commission_minor_units)
      })));
    });
  }

  async function updateConversionStatus({ tenantId: rawTenantId, conversionId: rawConversionId, status: rawStatus, actorId } = {}) {
    const id = conversionId(rawConversionId);
    const target = status(rawStatus);
    const actor = required(actorId, 'actorId');
    return inTenant(rawTenantId, async (tx, scopedTenant) => {
      const currentResult = await tx.query(`${SELECT_CONVERSION} WHERE c.tenant_id=$1 AND c.runtime_id=$2 FOR UPDATE`, [scopedTenant, id]);
      const current = rows(currentResult)[0];
      if (!current) throw new ConversionNotFoundError();
      if (current.status === target) return mapConversion(current);

      const occurredAt = new Date(clock()).toISOString();
      const updateResult = await tx.query(
        `UPDATE conversions
         SET status=$3, status_updated_at=$4
         WHERE tenant_id=$1 AND runtime_id=$2
         RETURNING *`,
        [scopedTenant, id, target, occurredAt]
      );
      const updated = {
        ...rows(updateResult)[0],
        link_runtime_id: current.link_runtime_id,
        offer_runtime_id: current.offer_runtime_id,
        product_runtime_id: current.product_runtime_id
      };

      await tx.query(
        `INSERT INTO audit_events
          (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
         VALUES ($1,$2,'conversion.status_changed','conversion',$3,'allowed','conversion reconciliation status changed',$4::jsonb)`,
        [scopedTenant, actor, id, JSON.stringify({ from: current.status, to: target })]
      );
      await tx.query(
        `INSERT INTO affiliate_domain_outbox (tenant_id, event_id, event_type, payload, occurred_at)
         VALUES ($1,$2,'conversion.status_changed',$3::jsonb,$4)`,
        [scopedTenant, `evt_${randomUUID()}`, JSON.stringify({ conversionId: id, from: current.status, to: target, actorId: actor }), occurredAt]
      );
      return mapConversion(updated);
    });
  }

  return Object.freeze({ getConversion, listConversions, aggregateCommission, updateConversionStatus });
}
