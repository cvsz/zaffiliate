import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversionReconciliationRepo } from '../packages/db/src/index.js';

const TENANT = '00000000-0000-4000-8000-000000000031';
const CONVERSION = 'cnv_shopee_commission_correction';

function createDb() {
  const calls = [];
  const current = {
    tenant_id: TENANT,
    runtime_id: CONVERSION,
    link_runtime_id: 'lnk_shopee_report',
    offer_runtime_id: 'off_shopee_report',
    product_runtime_id: 'prod_shopee_report',
    external_order_id: 'shopee-order-001',
    revenue_minor_units: 10000,
    currency: 'THB',
    commission_rate: 0.1,
    gross_commission_minor_units: 1000,
    commission_evidence: { source: 'shopee_th_report', sourceRowId: 'commission-row-original' },
    reconciliation_evidence: {},
    status: 'confirmed',
    occurred_at: '2026-09-20T10:00:00Z',
    created_at: '2026-09-20T10:01:00Z',
    status_updated_at: '2026-09-20T12:34:56Z'
  };
  const tx = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [current] };
      if (sql.startsWith('UPDATE conversions')) return { rows: [{ ...current, commission_rate: params[2], gross_commission_minor_units: params[3], commission_evidence: JSON.parse(params[4]) }] };
      return { rows: [] };
    }
  };
  return { db: { async transaction(fn) { return fn(tx); } }, calls };
}

test('Shopee commission correction preserves report-derived amount/rate and immutable source evidence', async () => {
  const { db, calls } = createDb();
  const repo = createConversionReconciliationRepo({ db });
  const input = {
    tenantId: TENANT,
    conversionId: CONVERSION,
    commissionRate: 0.075,
    grossCommissionMinorUnits: 750,
    actorId: 'shopee_th_report',
    observedAt: '2026-09-21T08:30:00Z',
    commissionEvidence: {
      source: 'shopee_th_report',
      sourceRowId: 'commission-correction-row-002',
      observedAt: '2026-09-21T08:30:00Z'
    }
  };

  assert.equal(typeof repo.correctCommission, 'function', 'repo must expose a bounded commission-correction operation');
  const updated = await repo.correctCommission(input);
  assert.equal(updated.commissionRate, input.commissionRate);
  assert.equal(updated.grossCommissionMinorUnits, input.grossCommissionMinorUnits);
  assert.deepEqual(updated.commissionEvidence, input.commissionEvidence);

  const audit = calls.find(({ sql }) => sql.includes('INSERT INTO audit_events'));
  const outbox = calls.find(({ sql }) => sql.includes('INSERT INTO affiliate_domain_outbox'));
  assert.ok(audit, 'correction must preserve durable audit evidence');
  assert.ok(outbox, 'correction must enqueue a durable event');
  assert.match(audit.params.join(' '), /commission-correction-row-002/);
  assert.match(outbox.params.join(' '), /commission-correction-row-002/);
});
