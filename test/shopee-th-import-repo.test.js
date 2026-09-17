import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShopeeThImportRepo } from '../packages/db/src/shopee-th-import-repo.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const ROW = Object.freeze({
  platform: 'shopee', market: 'TH', productId: '123', name: 'สินค้า', price: 99.5,
  productUrl: 'https://shopee.co.th/product/123', affiliateUrl: 'https://s.shopee.co.th/example',
  commission: Object.freeze({ observedRate: 0.12, observedAmount: 11.94, currency: 'THB', status: 'observed' }),
  provenance: Object.freeze({
    sourceType: 'shopee_th_affiliate_feed', sourceTimestamp: '2026-09-17T00:00:00.000Z',
    sourceFilename: 'feed.csv', rowNumber: 2,
    evidenceSha256: 'a'.repeat(64), schemaVersion: 1
  })
});

function fakeDb({ duplicate = false } = {}) {
  const calls = [];
  const tx = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('source_evidence_sha256') && sql.includes('SELECT o.id')) {
        return { rows: duplicate ? [{ id: 'offer-db', runtime_id: 'off_existing', product_runtime_id: 'prod_existing' }] : [] };
      }
      if (sql.includes('INSERT INTO products')) return { rows: [{ id: 'product-db', runtime_id: 'prod_123' }] };
      if (sql.includes('INSERT INTO offers')) return { rows: [{ id: 'offer-db', runtime_id: 'off_123' }] };
      return { rows: [] };
    }
  };
  return { calls, db: { transaction: (fn) => fn(tx) } };
}

test('persists normalized Shopee TH product/offer with tenant context and source evidence', async () => {
  const { db, calls } = fakeDb();
  const repo = createShopeeThImportRepo({ db });
  const result = await repo.persistNormalizedOffer(TENANT, ROW);
  assert.equal(result.duplicate, false);
  assert.equal(result.product_runtime_id, 'prod_123');
  assert.match(calls[0].sql, /set_config\('app\.tenant_id'/);
  const offerInsert = calls.find((call) => call.sql.includes('INSERT INTO offers'));
  assert.ok(offerInsert);
  assert.equal(offerInsert.params[0], TENANT);
  assert.equal(offerInsert.params[2], 9950);
  assert.equal(offerInsert.params[3], 0.12);
  assert.equal(offerInsert.params[8], 'a'.repeat(64));
  assert.equal(offerInsert.params[9], 1194);
});

test('replay of the same tenant/evidence is idempotent and does not write product or offer', async () => {
  const { db, calls } = fakeDb({ duplicate: true });
  const repo = createShopeeThImportRepo({ db });
  const result = await repo.persistNormalizedOffer(TENANT, ROW);
  assert.equal(result.duplicate, true);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO products')), false);
  assert.equal(calls.some((call) => call.sql.includes('INSERT INTO offers')), false);
});

test('fails closed for non-Shopee-TH rows and non-observed commission state', async () => {
  const { db } = fakeDb();
  const repo = createShopeeThImportRepo({ db });
  await assert.rejects(() => repo.persistNormalizedOffer(TENANT, { ...ROW, market: 'SG' }), /must be Shopee TH/);
  await assert.rejects(() => repo.persistNormalizedOffer(TENANT, { ...ROW, commission: { ...ROW.commission, status: 'estimated' } }), /source-observed/);
});
