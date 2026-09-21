import test from 'node:test';
import assert from 'node:assert/strict';
import { createAffiliateCoreRepo } from '../packages/db/src/affiliate-core-repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-21T01:00:00.000Z';
const SOURCE_OCCURRED_AT = '2026-09-20T12:34:56.000Z';

function replayDb() {
  const conversions = new Map();
  const outbox = [];
  return {
    conversions,
    outbox,
    async transaction(fn) {
      return fn({
        async query(text, params) {
          const sql = String(text).replace(/\s+/g, ' ').trim();
          if (sql.includes("set_config('app.tenant_id'")) return { rows: [] };
          if (sql.includes('FROM affiliate_links l') && sql.includes('l.runtime_id = $2')) {
            return { rows: [{
              id: 7,
              tenant_id: params[0],
              runtime_id: 'lnk_test',
              offer_id: 8,
              offer_runtime_id: 'off_test',
              product_runtime_id: 'prod_test',
              sub_ids: { subid: 'sub-stable' }
            }] };
          }
          if (sql.startsWith('SELECT id, runtime_id, commission_rate FROM offers')) {
            return { rows: [{ id: 8, runtime_id: 'off_test', commission_rate: 0.99 }] };
          }
          if (sql.startsWith('INSERT INTO conversions')) {
            const key = `${params[0]}:${params[2]}`;
            if (conversions.has(key)) return { rows: [] };
            const row = {
              tenant_id: params[0],
              runtime_id: params[1],
              external_order_id: params[2],
              offer_runtime_id: 'off_test',
              link_runtime_id: 'lnk_test',
              product_runtime_id: 'prod_test',
              revenue_minor_units: params[10],
              gross_commission_minor_units: params[11],
              commission_rate: params[12],
              commission_evidence: params[13],
              currency: params[8],
              occurred_at: params[9]
            };
            conversions.set(key, row);
            return { rows: [row] };
          }
          if (sql.includes('FROM conversions c') && sql.includes('external_order_id')) {
            const key = `${params[0]}:${params[1]}`;
            const row = conversions.get(key);
            return { rows: row ? [row] : [] };
          }
          if (sql.startsWith('INSERT INTO affiliate_domain_outbox')) {
            outbox.push({ tenantId: params[0], type: params[2], payload: params[3], occurredAt: params[4] });
            return { rows: [] };
          }
          return { rows: [] };
        }
      });
    }
  };
}

const REPORT_ROW = Object.freeze({
  linkId: 'lnk_test',
  orderRef: 'shopee-order-001',
  revenueMinorUnits: 100_00,
  currency: 'THB',
  occurredAt: SOURCE_OCCURRED_AT,
  commissionRate: 0.12,
  grossCommissionMinorUnits: 12_00,
  commissionEvidence: Object.freeze({
    source: 'shopee_th_report',
    sourceRowId: 'report-row-001',
    observedAt: SOURCE_OCCURRED_AT
  })
});

test('Shopee report conversion preserves source timestamp and commission evidence instead of current offer assumptions', async () => {
  const db = replayDb();
  const repo = createAffiliateCoreRepo({ db, clock: () => Date.parse(NOW) });

  const conversion = await repo.recordConversion(TENANT, REPORT_ROW);

  assert.equal(conversion.occurredAt, SOURCE_OCCURRED_AT, 'source-observed conversion timestamp must be preserved');
  assert.equal(conversion.commissionRate, REPORT_ROW.commissionRate, 'report commission rate must be persisted as evidence');
  assert.equal(conversion.grossCommissionMinorUnits, REPORT_ROW.grossCommissionMinorUnits, 'reported commission amount must not be recomputed from the current offer');
  assert.deepEqual(conversion.commissionEvidence, REPORT_ROW.commissionEvidence, 'commission provenance must remain attached to the durable conversion');
});

test('replaying the same Shopee report row reuses the durable conversion and emits one outbox event', async () => {
  const db = replayDb();
  const repo = createAffiliateCoreRepo({ db, clock: () => Date.parse(NOW) });

  const first = await repo.recordConversion(TENANT, REPORT_ROW);
  const second = await repo.recordConversion(TENANT, REPORT_ROW);

  assert.equal(second.conversionId, first.conversionId);
  assert.equal(db.conversions.size, 1);
  assert.equal(db.outbox.filter((event) => event.type === 'conversion.recorded').length, 1);
  assert.equal(second.occurredAt, SOURCE_OCCURRED_AT);
});

test('the same external order reference remains tenant-scoped', async () => {
  const db = replayDb();
  const repo = createAffiliateCoreRepo({ db, clock: () => Date.parse(NOW) });

  await repo.recordConversion(TENANT, REPORT_ROW);
  await repo.recordConversion(OTHER_TENANT, REPORT_ROW);

  assert.equal(db.conversions.size, 2, 'conversion replay identity must include tenant scope');
});
