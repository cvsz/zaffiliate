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

function toMinorUnits(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be a non-negative number`);
  const minor = Math.round(number * 100);
  if (!Number.isSafeInteger(minor)) throw new Error(`${name} is outside the supported range`);
  return minor;
}

function validateNormalized(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('normalized Shopee TH row is required');
  if (row.platform !== 'shopee' || row.market !== 'TH') throw new Error('normalized row must be Shopee TH');
  if (row.commission?.status !== 'observed') throw new Error('commission must be source-observed');
  const evidence = required(row.provenance?.evidenceSha256, 'provenance.evidenceSha256');
  if (!/^[0-9a-f]{64}$/.test(evidence)) throw new Error('provenance.evidenceSha256 must be a lowercase SHA-256 digest');
  return evidence;
}

export function createShopeeThImportRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction() is required');

  async function persistNormalizedOffer(rawTenantId, row) {
    const id = tenantId(rawTenantId);
    const evidence = validateNormalized(row);
    const priceMinorUnits = toMinorUnits(row.price, 'price');
    const commissionMinorUnits = toMinorUnits(row.commission.observedAmount, 'commission.observedAmount');
    const sourceTimestamp = new Date(required(row.provenance.sourceTimestamp, 'provenance.sourceTimestamp'));
    if (Number.isNaN(sourceTimestamp.getTime())) throw new Error('provenance.sourceTimestamp must be a valid timestamp');

    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]);

      const existing = await tx.query(
        `SELECT o.id, o.runtime_id, p.runtime_id AS product_runtime_id
           FROM offers o
           JOIN products p ON p.id = o.product_id AND p.tenant_id = o.tenant_id
          WHERE o.tenant_id = $1 AND o.source_evidence_sha256 = $2
          LIMIT 1`,
        [id, evidence]
      );
      if (existing.rows?.[0]) return Object.freeze({ ...existing.rows[0], duplicate: true });

      const product = await tx.query(
        `INSERT INTO products (tenant_id, runtime_id, platform, external_product_id, title, currency, created_at)
         VALUES ($1, 'prod_' || gen_random_uuid()::text, 'shopee', $2, $3, 'THB', $4)
         ON CONFLICT (tenant_id, platform, external_product_id)
         DO UPDATE SET title = EXCLUDED.title
         RETURNING id, runtime_id`,
        [id, required(row.productId, 'productId'), required(row.name, 'name'), sourceTimestamp.toISOString()]
      );
      const productRow = product.rows?.[0];
      if (!productRow) throw new Error('failed to persist Shopee TH product');

      const offer = await tx.query(
        `INSERT INTO offers (
           tenant_id, runtime_id, product_id, sale_price, price_minor_units, commission_rate, cost, currency,
           captured_at, created_at, source_type, source_timestamp, source_filename, source_row_number,
           source_evidence_sha256, observed_commission_minor_units, product_url, affiliate_url
         ) VALUES (
           $1, 'off_' || gen_random_uuid()::text, $2, $3, $3, $4, 0, 'THB',
           $5, $5, $6, $5, $7, $8, $9, $10, $11, $12
         )
         RETURNING id, runtime_id`,
        [
          id,
          productRow.id,
          priceMinorUnits,
          Number(row.commission.observedRate),
          sourceTimestamp.toISOString(),
          required(row.provenance.sourceType, 'provenance.sourceType'),
          row.provenance.sourceFilename ?? null,
          row.provenance.rowNumber ?? null,
          evidence,
          commissionMinorUnits,
          required(row.productUrl, 'productUrl'),
          required(row.affiliateUrl, 'affiliateUrl')
        ]
      );
      const offerRow = offer.rows?.[0];
      if (!offerRow) throw new Error('failed to persist Shopee TH offer');
      return Object.freeze({ ...offerRow, product_runtime_id: productRow.runtime_id, duplicate: false });
    });
  }

  return Object.freeze({ persistNormalizedOffer });
}
