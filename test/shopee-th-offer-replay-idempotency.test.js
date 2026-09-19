import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopeeThRepo } from '../packages/db/src/shopee-th-repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-20T00:00:00.000Z';

function replayClient() {
  const offers = new Map();
  const writes = [];
  return {
    writes,
    async transaction(fn) {
      return fn({
        async query(text, params) {
          const sql = String(text).replace(/\s+/g, ' ').trim();
          if (sql.includes("set_config('app.tenant_id'")) return { rows: [] };
          if (sql.startsWith('SELECT id, runtime_id FROM products')) {
            return { rows: [{ id: 42, runtime_id: 'shp_product_1' }] };
          }
          if (sql.startsWith('INSERT INTO offers')) {
            writes.push([...params]);
            const row = {
              runtime_id: params[1],
              price_minor_units: params[3],
              commission_rate: params[4],
              currency: params[5],
              source_timestamp: params[9],
              source_row_key: params[10],
              evidence_hash: params[15],
              import_batch_id: params[17],
              commission_amount_minor_units: params[18],
              updated_at: params[19]
            };
            offers.set(`${params[0]}:${params[1]}`, row);
            return { rows: [row] };
          }
          return { rows: [] };
        }
      });
    }
  };
}

const OFFER = Object.freeze({
  productId: 'shp_product_1',
  priceMinorUnits: 129950,
  commissionRate: 0.125,
  currency: 'THB',
  sourceType: 'product_feed_csv',
  sourceFilename: 'shopee-th-2026-09-19.csv',
  sourceTimestamp: '2026-09-19T03:04:05.000Z',
  sourceRowKey: 'row-27',
  shopId: 'shop-9',
  shopName: 'ร้านทดสอบ',
  sourceUrl: 'https://shopee.co.th/product/9/27',
  affiliateUrl: 'https://s.shopee.co.th/example',
  parserVersion: '1.0.0',
  importBatchId: 'shp_batch_27',
  commissionAmountMinorUnits: 16244
});

test('replaying the same canonical Shopee source row keeps one deterministic offer identity and observed evidence', async () => {
  const db = replayClient();
  const repo = createShopeeThRepo({ db, clock: () => Date.parse(NOW) });

  const first = await repo.upsertOffer(TENANT, OFFER);
  const second = await repo.upsertOffer(TENANT, OFFER);

  assert.equal(second.offerId, first.offerId, 'canonical source replay must reuse the offer runtime identity');
  assert.match(first.offerId, /^shp_[0-9a-f]{32}$/);

  assert.equal(db.writes.length, 2);
  assert.equal(db.writes[0][1], db.writes[1][1]);
  assert.equal(db.writes[0][9], OFFER.sourceTimestamp, 'source timestamp must remain source-observed');
  assert.equal(db.writes[1][9], OFFER.sourceTimestamp, 'replay must preserve source timestamp');
  assert.equal(db.writes[0][18], OFFER.commissionAmountMinorUnits, 'commission amount must remain source-observed');
  assert.equal(db.writes[1][18], OFFER.commissionAmountMinorUnits, 'replay must not invent commission assumptions');
  assert.equal(db.writes[0][15], db.writes[1][15], 'replay must preserve evidence identity');
});
