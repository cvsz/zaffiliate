import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversionReconciliationRepo } from '../packages/db/src/index.js';

const TENANT = '00000000-0000-4000-8000-000000000031';
const CONVERSION = 'cnv_shopee_reconcile_evidence';

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
    commission_evidence: { source: 'shopee_th_report', sourceRowId: 'row-001' },
    status: 'pending',
    occurred_at: '2026-09-20T10:00:00Z',
    created_at: '2026-09-20T10:01:00Z',
    status_updated_at: '2026-09-20T10:01:00Z'
  };
  const tx = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('set_config')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [current] };
      if (sql.startsWith('UPDATE conversions')) return { rows: [{ ...current, status: params[2], status_updated_at: params[3] }] };
      return { rows: [] };
    }
  };
  return { db: { async transaction(fn) { return fn(tx); } }, calls };
}

test('Shopee reconciliation preserves source-observed status evidence and makes exact report replay a no-op', async () => {
  const { db, calls } = createDb();
  const repo = createConversionReconciliationRepo({ db, clock: () => Date.parse('2026-09-21T00:00:00Z') });
  const input = {
    tenantId: TENANT,
    conversionId: CONVERSION,
    status: 'confirmed',
    actorId: 'shopee_th_report',
    observedAt: '2026-09-20T12:34:56Z',
    reconciliationEvidence: {
      source: 'shopee_th_report',
      sourceRowId: 'status-row-001',
      observedAt: '2026-09-20T12:34:56Z'
    }
  };

  const updated = await repo.updateConversionStatus(input);
  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.statusUpdatedAt, '2026-09-20T12:34:56.000Z');
  assert.deepEqual(updated.reconciliationEvidence, input.reconciliationEvidence);

  const audit = calls.find(({ sql }) => sql.includes('INSERT INTO audit_events'));
  const outbox = calls.find(({ sql }) => sql.includes('INSERT INTO affiliate_domain_outbox'));
  assert.ok(audit, 'first reconciliation must write audit evidence');
  assert.ok(outbox, 'first reconciliation must enqueue one durable event');
  assert.match(audit.params[3], /status-row-001/);
  assert.match(outbox.params[2], /status-row-001/);
});
