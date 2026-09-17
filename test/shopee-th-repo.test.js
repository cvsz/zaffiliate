import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopeeThRepo } from '../packages/db/src/shopee-th-repo.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function fakeClient() {
  const queries = [];
  const batches = new Map();
  const products = new Map();
  return {
    queries,
    async transaction(fn) {
      const tx = {
        async query(text, params) {
          queries.push({ tx: true, text: String(text).replace(/\s+/g, ' ').trim(), params });
          const n = String(text).toUpperCase();
          if (n.includes('INSERT') && n.includes('SHOPEE_TH_IMPORT_BATCHES')) {
            const row = { batch_id: params[1], status: 'started', row_count: 0, accepted_count: 0, rejected_count: 0, evidence_hash: null, started_at: '2026-09-16T00:00:00.000Z', completed_at: null };
            batches.set(params[1], row);
            return { rows: [row] };
          }
          if (n.includes('UPDATE') && n.includes('SHOPEE_TH_IMPORT_BATCHES')) {
            const row = batches.get(params[1]);
            if (!row || row.status !== 'started') return { rows: [] };
            row.status = 'completed';
            row.row_count = params[2];
            row.accepted_count = params[3];
            row.rejected_count = params[4];
            row.evidence_hash = params[5] ?? null;
            row.completed_at = '2026-09-16T00:00:00.000Z';
            return { rows: [row] };
          }
          if (n.includes('SELECT') && n.includes('SHOPEE_TH_IMPORT_BATCHES')) {
            const row = batches.get(params[1]);
            return row ? { rows: [row] } : { rows: [] };
          }
          if (n.includes('SELECT') && n.includes('PRODUCTS')) {
            const row = products.get(params[1]);
            return row ? { rows: [row] } : { rows: [] };
          }
          if (n.includes('INSERT') && n.includes('PRODUCTS')) {
            const row = { runtime_id: params[1], external_product_id: params[3], title: params[4], currency: params[5], import_batch_id: params[15], updated_at: '2026-09-16T00:00:00.000Z' };
            products.set(params[1], row);
            return { rows: [row] };
          }
          if (n.includes('UPDATE') && n.includes('PRODUCTS')) {
            return { rows: [{ runtime_id: params[1], external_product_id: params[3], title: params[4], currency: params[5], import_batch_id: params[15], updated_at: '2026-09-16T00:00:00.000Z' }] };
          }
          if (n.includes('INSERT') && n.includes('OFFERS')) {
            return { rows: [{ runtime_id: params[1], price_minor_units: params[3], commission_rate: 0.1, currency: params[7], import_batch_id: params[17], updated_at: '2026-09-16T00:00:00.000Z' }] };
          }
          if (n.includes('UPDATE') && n.includes('OFFERS')) {
            return { rows: [{ runtime_id: params[1], price_minor_units: params[3], commission_rate: 0.1, currency: params[7], import_batch_id: params[17], updated_at: '2026-09-16T00:00:00.000Z' }] };
          }
          return { rows: [] };
        }
      };
      return fn(tx);
    }
  };
}

function lastQuery(client) {
  return client.queries[client.queries.length - 1];
}

test('repo requires a db with transaction()', () => {
  assert.throws(() => createShopeeThRepo({}), /transaction/);
  assert.throws(() => createShopeeThRepo({ db: {} }), /transaction/);
});

test('startBatch creates a started batch ledger row idempotently', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  const first = await repo.startBatch(TENANT_A, { sourceType: 'product_feed', parserVersion: '1.0.0' });
  assert.match(first.batchId, /^shp_/);
  assert.equal(first.status, 'started');
  const second = await repo.startBatch(TENANT_A, { batchId: first.batchId, sourceType: 'product_feed', parserVersion: '1.0.0' });
  assert.equal(second.batchId, first.batchId);
  const tenantGuc = client.queries.find((q) => q.text.includes("set_config('app.tenant_id'"));
  assert.ok(tenantGuc, 'tenant GUC is set per transaction');
});

test('upsertProduct inserts and updates provenance in one transaction', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await repo.upsertProduct(TENANT_A, {
    productId: 'shp_1', externalProductId: 'SP001', title: 'Product A',
    priceMinorUnits: 12350, currency: 'THB', sourceRowKey: 'row-1',
    parserVersion: '1.0.0', importBatchId: 'shp_batch_1'
  });
  const q = lastQuery(client);
  assert.match(q.text, /INSERT INTO products/i);
  assert.match(q.text, /ON CONFLICT \(tenant_id, platform, external_product_id\)/i);
  assert.equal(q.params[1], 'shp_1');
  assert.equal(q.params[2], 'shopee');
  assert.equal(q.params[3], 'SP001');
  assert.equal(q.params[15], 'shp_batch_1');
});

test('upsertOffer fails closed when the product is unknown', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await assert.rejects(() => repo.upsertOffer(TENANT_A, { productId: 'missing' }), /not found/);
});

test('completeBatch records accepted/rejected counts and evidence hash', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  const started = await repo.startBatch(TENANT_A, { batchId: 'shp_b1', sourceType: 'product_feed', parserVersion: '1.0.0' });
  const done = await repo.completeBatch(TENANT_A, {
    batchId: started.batchId, rowCount: 10, acceptedCount: 8, rejectedCount: 2,
    evidenceHash: 'raw-evidence'
  });
  assert.equal(done.status, 'completed');
  assert.equal(done.rowCount, 10);
  assert.equal(done.acceptedCount, 8);
  assert.equal(done.rejectedCount, 2);
  assert.equal(done.evidenceHash, '8528abdeae3fab63fe1d9fe7f1043d18cb79aac5c583d85834c2c2a24406fbbd');
  const q = lastQuery(client);
  assert.match(q.text, /UPDATE shopee_th_import_batches/i);
  assert.equal(q.params[5], '8528abdeae3fab63fe1d9fe7f1043d18cb79aac5c583d85834c2c2a24406fbbd');
});

test('failBatch closes only a started batch', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await repo.startBatch(TENANT_A, { batchId: 'shp_b2', sourceType: 'product_feed', parserVersion: '1.0.0' });
  const failed = await repo.failBatch(TENANT_A, { batchId: 'shp_b2' });
  assert.equal(failed.status, 'failed');
  await assert.rejects(() => repo.failBatch(TENANT_A, { batchId: 'shp_b2' }), /already closed/);
});

test('getBatch returns null for unknown batches and frozen objects', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  const unknown = await repo.getBatch(TENANT_A, 'shp_unknown');
  assert.equal(unknown, null);
  await repo.startBatch(TENANT_A, { batchId: 'shp_b3', sourceType: 'product_feed', parserVersion: '1.0.0' });
  const found = await repo.getBatch(TENANT_A, 'shp_b3');
  assert.equal(found.batchId, 'shp_b3');
  assert.ok(Object.isFrozen(found));
});

test('listBatches is tenant-scoped and ordered by started_at DESC', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await repo.startBatch(TENANT_A, { batchId: 'shp_a1', sourceType: 'product_feed', parserVersion: '1.0.0' });
  await repo.startBatch(TENANT_B, { batchId: 'shp_b1', sourceType: 'product_feed', parserVersion: '1.0.0' });
  const list = await repo.listBatches(TENANT_A, { limit: 50 });
  assert.equal(list.length, 1);
  assert.equal(list[0].batchId, 'shp_a1');
  const q = lastQuery(client);
  assert.equal(q.params[0], TENANT_A);
  assert.match(q.text, /ORDER BY started_at DESC/);
});

test('evidenceHash is a stable sha256 hex digest', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await repo.upsertProduct(TENANT_A, {
    productId: 'shp_hash', externalProductId: 'SP_HASH', title: 'Hashed',
    sourceRowKey: 'row-1', parserVersion: '1.0.0'
  });
  const q = lastQuery(client);
  assert.equal(q.params[13], '0f719b1f3a428a4dd53c61b3bdc5c2ec279c2e6139f160b3bbb8df8e7efdead8');
});

test('tenantId must be a UUID', async () => {
  const client = fakeClient();
  const repo = createShopeeThRepo({ db: client });
  await assert.rejects(() => repo.startBatch('not-a-uuid', { sourceType: 'product_feed', parserVersion: '1.0.0' }), /UUID/);
});