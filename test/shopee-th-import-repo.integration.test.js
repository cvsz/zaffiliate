import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createShopeeThImportRepo } from '../packages/db/src/shopee-th-import-repo.js';

const RUN = process.env.SHOPEE_TH_DB_INTEGRATION === '1';
const CONNECTION = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/zaffiliate_test';
const TENANT_A = '81000000-0000-4000-8000-0000000000a1';
const TENANT_B = '82000000-0000-4000-8000-0000000000b2';

function appRoleDb(pool) {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE zaffiliate_app_test');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function normalizedRow(evidence = 'a'.repeat(64)) {
  return {
    platform: 'shopee',
    market: 'TH',
    productId: 'shopee-th-rls-001',
    name: 'Shopee TH RLS fixture',
    shopName: 'Fixture Shop',
    price: 199.5,
    sold: 42,
    productUrl: 'https://shopee.co.th/product/rls-fixture',
    affiliateUrl: 'https://s.shopee.co.th/rls-fixture',
    commission: { status: 'observed', observedRate: 0.075, observedAmount: 14.96 },
    provenance: {
      sourceType: 'shopee_th_product_feed_csv',
      sourceTimestamp: '2026-09-17T00:00:00.000Z',
      sourceFilename: 'shopee-th-rls.csv',
      sourceRowNumber: 2,
      evidenceSha256: evidence
    }
  };
}

async function queryAsApp(pool, tenantId, text, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE zaffiliate_app_test');
    if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(text, params);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

test('Shopee TH import is replay-idempotent and RLS-isolated in real Postgres', { skip: !RUN }, async (t) => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: CONNECTION });
  
  // Clean up before test
  await pool.query('DELETE FROM offers WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]);
  await pool.query('DELETE FROM products WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]);
  await pool.query('DELETE FROM tenants WHERE id IN ($1,$2)', [TENANT_A, TENANT_B]);
  
  try {
    await pool.query(
      `INSERT INTO tenants (id, slug, name) VALUES
         ($1, 'shopee-th-rls-a1', 'Shopee TH RLS A'),
         ($2, 'shopee-th-rls-b2', 'Shopee TH RLS B')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A, TENANT_B]
    );
  
    const repo = createShopeeThImportRepo({ db: appRoleDb(pool) });
    const first = await repo.persistNormalizedOffer(TENANT_A, normalizedRow());
    assert.equal(first.duplicate, false);
    const replay = await repo.persistNormalizedOffer(TENANT_A, normalizedRow());
    assert.equal(replay.duplicate, true);
    assert.equal(replay.id, first.id);
  
    const visibleA = await queryAsApp(pool, TENANT_A, 'SELECT id FROM offers WHERE id=$1', [first.id]);
    assert.equal(visibleA.rowCount, 1);
    const hiddenFromB = await queryAsApp(pool, TENANT_B, 'SELECT id FROM offers WHERE id=$1', [first.id]);
    assert.equal(hiddenFromB.rowCount, 0, 'tenant B must not read tenant A offer');
  
    const sameEvidenceB = await repo.persistNormalizedOffer(TENANT_B, normalizedRow());
    assert.equal(sameEvidenceB.duplicate, false, 'evidence idempotency is tenant-scoped');
    assert.notEqual(sameEvidenceB.id, first.id);
  } finally {
    // Clean up after test
    await pool.query('DELETE FROM offers WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]);
    await pool.query('DELETE FROM products WHERE tenant_id IN ($1,$2)', [TENANT_A, TENANT_B]);
    await pool.query('DELETE FROM tenants WHERE id IN ($1,$2)', [TENANT_A, TENANT_B]);
    await pool.end();
  }
});

test('Shopee TH offer access fails closed without tenant context under app role', { skip: !RUN }, async (t) => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: CONNECTION });
  t.after(() => pool.end());
  const result = await queryAsApp(pool, null, 'SELECT id FROM offers LIMIT 1');
  assert.equal(result.rowCount, 0, 'must return zero rows when tenant context is missing');
});
