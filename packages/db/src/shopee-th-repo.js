// Shopee Thailand Affiliate durable persistence (SLICE 2).
//
// Idempotent import-batch ledger and product/offer persistence over the
// canonical products/offers tables extended with Shopee TH provenance by
// migration 015. All writes run inside a transaction with the tenant GUC set
// so RLS FORCE is enforced as defense-in-depth.

import { createHash, randomUUID } from 'node:crypto';

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

function nonNegativeInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function evidenceHash(raw) {
  if (raw == null) return null;
  return createHash('sha256').update(String(raw)).digest('hex');
}

async function setTenant(tx, id) {
  await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
}

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function createShopeeThRepo({ db, clock = () => Date.now() } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction() is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  function nowIso() { return new Date(clock()).toISOString(); }

  async function inTenant(rawTenantId, fn) {
    const id = tenantId(rawTenantId);
    return db.transaction(async (tx) => {
      await setTenant(tx, id);
      return fn(tx, id);
    });
  }

  async function startBatch(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('batch input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const batchId = input.batchId == null ? `shp_${randomUUID()}` : required(input.batchId, 'batchId');
      const occurredAt = nowIso();
      const result = await tx.query(
        `INSERT INTO shopee_th_import_batches
           (tenant_id, batch_id, source_filename, source_type, parser_version, row_count, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 0, 'started', $6)
         ON CONFLICT (tenant_id, batch_id) DO NOTHING
         RETURNING *`,
        [id, batchId, input.sourceFilename ?? null, required(input.sourceType, 'sourceType'), required(input.parserVersion, 'parserVersion'), occurredAt]
      );
      const row = rows(result)[0];
      if (!row) {
        const existing = rows(await tx.query(
          'SELECT status FROM shopee_th_import_batches WHERE tenant_id = $1 AND batch_id = $2 LIMIT 1',
          [id, batchId]
        ))[0];
        if (!existing) throw new Error(`import batch ${batchId} replay conflict`);
        throw new Error(`import batch ${batchId} already exists with status ${existing.status}; replay refused`);
      }
      return Object.freeze({ batchId: row.batch_id, tenantId: id, status: row.status, startedAt: new Date(row.started_at).toISOString() });
    });
  }

  async function upsertProduct(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('product input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const productId = required(input.productId, 'productId');
      const occurredAt = nowIso();
      const result = await tx.query(
        `INSERT INTO products
           (tenant_id, runtime_id, platform, external_product_id, title, currency,
            source_type, source_filename, source_timestamp, source_row_key,
            shop_id, shop_name, source_url, affiliate_url, evidence_hash,
            import_batch_id, parser_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
         ON CONFLICT (tenant_id, platform, external_product_id) DO UPDATE SET
           title = EXCLUDED.title, currency = EXCLUDED.currency, source_type = EXCLUDED.source_type,
           source_filename = EXCLUDED.source_filename, source_timestamp = EXCLUDED.source_timestamp,
           source_row_key = EXCLUDED.source_row_key, shop_id = EXCLUDED.shop_id, shop_name = EXCLUDED.shop_name,
           source_url = EXCLUDED.source_url, affiliate_url = EXCLUDED.affiliate_url, evidence_hash = EXCLUDED.evidence_hash,
           import_batch_id = EXCLUDED.import_batch_id, parser_version = EXCLUDED.parser_version, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [id, productId, 'shopee', required(input.externalProductId, 'externalProductId'), required(input.title, 'title'),
         input.currency ?? 'THB', input.sourceType ?? null, input.sourceFilename ?? null, input.sourceTimestamp ?? null,
         input.sourceRowKey ?? null, input.shopId ?? null, input.shopName ?? null, input.sourceUrl ?? null,
         input.affiliateUrl ?? null, evidenceHash(input.evidenceHash ?? input.sourceRowKey), input.importBatchId ?? null,
         input.parserVersion ?? null, occurredAt]
      );
      const row = rows(result)[0];
      return Object.freeze({ tenantId: id, productId: row.runtime_id, externalProductId: row.external_product_id,
        title: row.title, currency: row.currency, importBatchId: row.import_batch_id,
        updatedAt: new Date(row.updated_at).toISOString() });
    });
  }

  async function upsertOffer(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('offer input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const productId = required(input.productId, 'productId');
      const productResult = await tx.query('SELECT id, runtime_id FROM products WHERE tenant_id = $1 AND runtime_id = $2', [id, productId]);
      const product = rows(productResult)[0];
      if (!product) throw new Error(`product ${productId} not found`);
      const offerId = `shp_${randomUUID()}`;
      const occurredAt = nowIso();
      const result = await tx.query(
        `INSERT INTO offers
           (tenant_id, runtime_id, product_id, sale_price, price_minor_units, commission_rate, cost, currency,
            captured_at, source_type, source_filename, source_timestamp, source_row_key,
            shop_id, shop_name, source_url, affiliate_url, evidence_hash,
            parser_version, import_batch_id, commission_amount_minor_units, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20)
         ON CONFLICT (tenant_id, runtime_id) DO UPDATE SET
           sale_price = EXCLUDED.sale_price, price_minor_units = EXCLUDED.price_minor_units,
           commission_rate = EXCLUDED.commission_rate, currency = EXCLUDED.currency,
           captured_at = EXCLUDED.captured_at, source_type = EXCLUDED.source_type,
           source_filename = EXCLUDED.source_filename, source_timestamp = EXCLUDED.source_timestamp,
           source_row_key = EXCLUDED.source_row_key, shop_id = EXCLUDED.shop_id, shop_name = EXCLUDED.shop_name,
           source_url = EXCLUDED.source_url, affiliate_url = EXCLUDED.affiliate_url,
           evidence_hash = EXCLUDED.evidence_hash, parser_version = EXCLUDED.parser_version,
           import_batch_id = EXCLUDED.import_batch_id,
           commission_amount_minor_units = EXCLUDED.commission_amount_minor_units, updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [id, offerId, product.id, nonNegativeInt(input.priceMinorUnits, 'priceMinorUnits'), Number(input.commissionRate),
         input.currency ?? 'THB', occurredAt, input.sourceType ?? null, input.sourceFilename ?? null,
         input.sourceTimestamp ?? null, input.sourceRowKey ?? null, input.shopId ?? null, input.shopName ?? null,
         input.sourceUrl ?? null, input.affiliateUrl ?? null, evidenceHash(input.evidenceHash ?? input.sourceRowKey),
         input.parserVersion ?? null, input.importBatchId ?? null,
         input.commissionAmountMinorUnits == null ? null : nonNegativeInt(input.commissionAmountMinorUnits, 'commissionAmountMinorUnits'),
         occurredAt]
      );
      const row = rows(result)[0];
      return Object.freeze({ tenantId: id, offerId: row.runtime_id, productId: product.runtime_id,
        priceMinorUnits: Number(row.price_minor_units), currency: row.currency, importBatchId: row.import_batch_id,
        updatedAt: new Date(row.updated_at).toISOString() });
    });
  }

  async function completeBatch(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('batch completion input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const batchId = required(input.batchId, 'batchId');
      const occurredAt = nowIso();
      const result = await tx.query(
        `UPDATE shopee_th_import_batches
         SET row_count = $3, accepted_count = $4, rejected_count = $5, evidence_hash = $6,
             status = 'completed', completed_at = $7
         WHERE tenant_id = $1 AND batch_id = $2 RETURNING *`,
        [id, batchId, nonNegativeInt(input.rowCount, 'rowCount'), nonNegativeInt(input.acceptedCount, 'acceptedCount'),
         nonNegativeInt(input.rejectedCount, 'rejectedCount'), input.evidenceHash == null ? null : evidenceHash(input.evidenceHash), occurredAt]
      );
      const row = rows(result)[0];
      if (!row) throw new Error(`import batch ${batchId} not found`);
      return Object.freeze({ tenantId: id, batchId: row.batch_id, status: row.status, rowCount: Number(row.row_count),
        acceptedCount: Number(row.accepted_count), rejectedCount: Number(row.rejected_count), evidenceHash: row.evidence_hash,
        completedAt: new Date(row.completed_at).toISOString() });
    });
  }

  async function failBatch(rawTenantId, input) {
    if (!input || typeof input !== 'object') throw new TypeError('batch failure input is required');
    return inTenant(rawTenantId, async (tx, id) => {
      const batchId = required(input.batchId, 'batchId');
      const result = await tx.query(
        `UPDATE shopee_th_import_batches SET status = 'failed', completed_at = now()
         WHERE tenant_id = $1 AND batch_id = $2 AND status = 'started' RETURNING *`, [id, batchId]);
      const row = rows(result)[0];
      if (!row) throw new Error(`import batch ${batchId} not found or already closed`);
      return Object.freeze({ tenantId: id, batchId: row.batch_id, status: row.status });
    });
  }

  async function getBatch(rawTenantId, rawBatchId) {
    const batchId = required(rawBatchId, 'batchId');
    return inTenant(rawTenantId, async (tx, id) => {
      const result = await tx.query('SELECT * FROM shopee_th_import_batches WHERE tenant_id = $1 AND batch_id = $2 LIMIT 1', [id, batchId]);
      const row = rows(result)[0];
      if (!row) return null;
      return Object.freeze({ tenantId: id, batchId: row.batch_id, status: row.status, rowCount: Number(row.row_count),
        acceptedCount: Number(row.accepted_count), rejectedCount: Number(row.rejected_count), evidenceHash: row.evidence_hash,
        startedAt: new Date(row.started_at).toISOString(), completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null });
    });
  }

  async function listBatches(rawTenantId, { limit = 50 } = {}) {
    const batch = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return inTenant(rawTenantId, async (tx, id) => {
      const result = await tx.query(
        `SELECT batch_id, status, row_count, accepted_count, rejected_count, evidence_hash, started_at, completed_at
         FROM shopee_th_import_batches WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT $2`, [id, batch]);
      return Object.freeze(rows(result).map((row) => Object.freeze({ tenantId: id, batchId: row.batch_id, status: row.status,
        rowCount: Number(row.row_count), acceptedCount: Number(row.accepted_count), rejectedCount: Number(row.rejected_count),
        evidenceHash: row.evidence_hash, startedAt: new Date(row.started_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null })));
    });
  }

  return Object.freeze({ startBatch, upsertProduct, upsertOffer, completeBatch, failBatch, getBatch, listBatches });
}
