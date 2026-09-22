import test from 'node:test';
import assert from 'node:assert/strict';
import { createDbClient, createConversionReconciliationRepo } from '../packages/db/src/index.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const TENANT = '00000000-0000-4000-8000-000000000031';

const PRODUCT_UUID = '31000000-0000-4000-8000-000000000001';
const OFFER_UUID = '31000000-0000-4000-8000-000000000002';
const LINK_UUID = '31000000-0000-4000-8000-000000000003';

async function seed(db) {
  await db.query("INSERT INTO tenants (id, slug, name) VALUES ($1, 'conversion-repo', 'Conversion Repo')", [TENANT]);
  await db.query(
    `INSERT INTO products (tenant_id, id, runtime_id, platform, external_product_id, title, currency)
     VALUES ($1,$2,'prod_reconcile_repo','tiktok','repo-product','Repo Product','THB')`,
    [TENANT, PRODUCT_UUID]
  );
  await db.query(
    `INSERT INTO offers (tenant_id,id,runtime_id,product_id,sale_price,price_minor_units,commission_rate,cost,currency,captured_at)
     VALUES ($1,$2,'off_reconcile_repo',$3,10000,10000,0.10,0,'THB',now())`,
    [TENANT, OFFER_UUID, PRODUCT_UUID]
  );
  await db.query(
    `INSERT INTO affiliate_links (tenant_id,id,runtime_id,offer_id,url,destination_url,deep_link_url,sub_id,sub_ids,slug)
     VALUES ($1,$2,'lnk_reconcile_repo',$3,'https://example.test/p?subid=repo','https://example.test/p','https://example.test/p?subid=repo','repo','{"subid":"repo"}'::jsonb,'reconcile-repo')`,
    [TENANT, LINK_UUID, OFFER_UUID]
  );
  await db.query(
    `INSERT INTO conversions (
       tenant_id,runtime_id,external_order_id,offer_id,affiliate_link_id,
       gross_revenue,commission,cost,currency,occurred_at,
       revenue_minor_units,gross_commission_minor_units,commission_rate
     ) VALUES
       ($1,'cnv_repo_thb','repo-order-thb',$2,$3,10000,1000,0,'THB','2026-08-30T10:00:00Z',10000,1000,0.10),
       ($1,'cnv_repo_usd','repo-order-usd',$2,$3,20000,2000,0,'USD','2026-08-31T10:00:00Z',20000,2000,0.10)`,
    [TENANT, OFFER_UUID, LINK_UUID]
  );
}

test('conversion reconciliation repository persists status and commission correction evidence with idempotent outbox and currency-safe aggregates', async (t) => {
  const db = createDbClient({ connectionString: DATABASE_URL || null });
  const probe = await db.check();
  if (!probe.reachable) {
    t.skip(`postgres not reachable (${probe.reason})`);
    await db.close();
    return;
  }
  t.after(async () => db.close());
  await seed(db);
  const repo = createConversionReconciliationRepo({ db, clock: () => Date.parse('2026-08-31T12:00:00Z') });

  const initial = await repo.getConversion({ tenantId: TENANT, conversionId: 'cnv_repo_thb' });
  assert.equal(initial.status, 'pending');

  const updated = await repo.updateConversionStatus({
    tenantId: TENANT,
    conversionId: 'cnv_repo_thb',
    status: 'confirmed',
    actorId: 'usr_reconciler'
  });
  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.statusUpdatedAt, '2026-08-31T12:00:00.000Z');

  const audit = await db.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND action='conversion.status_changed' AND resource_id='cnv_repo_thb'",
    [TENANT]
  );
  const outbox = await db.query(
    "SELECT count(*)::int AS count FROM affiliate_domain_outbox WHERE tenant_id=$1 AND event_type='conversion.status_changed' AND payload->>'conversionId'='cnv_repo_thb'",
    [TENANT]
  );
  assert.equal(audit.rows[0].count, 1);
  assert.equal(outbox.rows[0].count, 1);

  await repo.updateConversionStatus({ tenantId: TENANT, conversionId: 'cnv_repo_thb', status: 'confirmed', actorId: 'usr_reconciler' });
  const outboxAfterRetry = await db.query(
    "SELECT count(*)::int AS count FROM affiliate_domain_outbox WHERE tenant_id=$1 AND event_type='conversion.status_changed' AND payload->>'conversionId'='cnv_repo_thb'",
    [TENANT]
  );
  assert.equal(outboxAfterRetry.rows[0].count, 1, 'same-status retry must not emit a duplicate event');

  const observedAt = '2026-08-31T13:15:00.000Z';
  const commissionEvidence = {
    source: 'shopee_affiliate_report',
    sourceRowId: 'shopee-row-correction-001',
    observedAt,
    reportId: 'shopee-report-2026-08-31'
  };
  const corrected = await repo.correctCommission({
    tenantId: TENANT,
    conversionId: 'cnv_repo_thb',
    commissionRate: 0.125,
    grossCommissionMinorUnits: 1250,
    actorId: 'usr_reconciler',
    observedAt,
    commissionEvidence
  });
  assert.equal(corrected.commissionRate, 0.125);
  assert.equal(corrected.grossCommissionMinorUnits, 1250);
  assert.deepEqual(corrected.commissionEvidence, commissionEvidence);

  const correctionAudit = await db.query(
    "SELECT count(*)::int AS count FROM audit_events WHERE tenant_id=$1 AND action='conversion.commission_corrected' AND resource_id='cnv_repo_thb'",
    [TENANT]
  );
  const correctionOutbox = await db.query(
    "SELECT count(*)::int AS count FROM affiliate_domain_outbox WHERE tenant_id=$1 AND event_type='conversion.commission_corrected' AND payload->>'conversionId'='cnv_repo_thb'",
    [TENANT]
  );
  assert.equal(correctionAudit.rows[0].count, 1);
  assert.equal(correctionOutbox.rows[0].count, 1);

  await repo.correctCommission({
    tenantId: TENANT,
    conversionId: 'cnv_repo_thb',
    commissionRate: 0.125,
    grossCommissionMinorUnits: 1250,
    actorId: 'usr_reconciler',
    observedAt,
    commissionEvidence
  });
  const correctionOutboxAfterReplay = await db.query(
    "SELECT count(*)::int AS count FROM affiliate_domain_outbox WHERE tenant_id=$1 AND event_type='conversion.commission_corrected' AND payload->>'conversionId'='cnv_repo_thb'",
    [TENANT]
  );
  assert.equal(correctionOutboxAfterReplay.rows[0].count, 1, 'same source-row replay must not emit a duplicate correction event');

  const confirmed = await repo.listConversions({ tenantId: TENANT, status: 'confirmed' });
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].conversionId, 'cnv_repo_thb');

  const summary = await repo.aggregateCommission({ tenantId: TENANT });
  assert.equal(summary.length, 2);
  assert.deepEqual(summary.map((row) => row.currency).sort(), ['THB', 'USD']);
  assert.equal(summary.find((row) => row.currency === 'THB').totalGrossCommissionMinorUnits, '1250');
  assert.equal(summary.find((row) => row.currency === 'USD').totalGrossCommissionMinorUnits, '2000');
});
