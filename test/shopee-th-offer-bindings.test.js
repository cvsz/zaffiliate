import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createShopeeThRepo } from '../packages/db/src/shopee-th-repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-18T00:00:00.000Z';

function bindingClient() {
  const queries = [];
  return {
    queries,
    async transaction(fn) {
      return fn({
        async query(text, params) {
          const sql = String(text).replace(/\s+/g, ' ').trim();
          queries.push({ text: sql, params });
          if (sql.includes("set_config('app.tenant_id'")) return { rows: [] };
          if (sql.startsWith('SELECT id, runtime_id FROM products')) {
            return { rows: [{ id: 42, runtime_id: 'shp_product_1' }] };
          }
          if (sql.startsWith('INSERT INTO offers')) {
            return {
              rows: [{
                runtime_id: params[1],
                price_minor_units: params[3],
                commission_rate: params[4],
                currency: params[5],
                import_batch_id: params[17],
                updated_at: params[19]
              }]
            };
          }
          return { rows: [] };
        }
      });
    }
  };
}

test('upsertOffer binds price, observed commission, provenance, batch and timestamps to their SQL placeholders', async () => {
  const db = bindingClient();
  const repo = createShopeeThRepo({ db, clock: () => Date.parse(NOW) });

  const result = await repo.upsertOffer(TENANT, {
    productId: 'shp_product_1',
    priceMinorUnits: 129950,
    commissionRate: 0.125,
    currency: 'THB',
    sourceType: 'product_feed_csv',
    sourceFilename: 'shopee-th-2026-09-17.csv',
    sourceTimestamp: '2026-09-17T03:04:05.000Z',
    sourceRowKey: 'row-27',
    shopId: 'shop-9',
    shopName: 'ร้านทดสอบ',
    sourceUrl: 'https://shopee.co.th/product/9/27',
    affiliateUrl: 'https://s.shopee.co.th/example',
    parserVersion: '1.0.0',
    importBatchId: 'shp_batch_27',
    commissionAmountMinorUnits: 16244
  });

  const insert = db.queries.find((q) => q.text.startsWith('INSERT INTO offers'));
  assert.ok(insert);
  assert.match(insert.text, /commission_amount_minor_units, created_at, updated_at\) VALUES .*\$19, \$20, \$20\)/);
  assert.equal(insert.params.length, 20);
  assert.deepEqual(insert.params.slice(2), [
    42,
    129950,
    0.125,
    'THB',
    NOW,
    'product_feed_csv',
    'shopee-th-2026-09-17.csv',
    '2026-09-17T03:04:05.000Z',
    'row-27',
    'shop-9',
    'ร้านทดสอบ',
    'https://shopee.co.th/product/9/27',
    'https://s.shopee.co.th/example',
    createHash('sha256').update('row-27').digest('hex'),
    '1.0.0',
    'shp_batch_27',
    16244,
    NOW
  ]);
  assert.equal(result.priceMinorUnits, 129950);
  assert.equal(result.currency, 'THB');
  assert.equal(result.importBatchId, 'shp_batch_27');
});
