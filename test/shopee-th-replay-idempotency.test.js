import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopeeThRepo } from '../packages/db/src/shopee-th-repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function replayClient() {
  const batches = new Map();
  return {
    async transaction(fn) {
      return fn({
        async query(text, params) {
          const sql = String(text).replace(/\s+/g, ' ').trim();
          if (sql.includes("set_config('app.tenant_id'")) return { rows: [] };
          if (sql.startsWith('INSERT INTO shopee_th_import_batches')) {
            const key = `${params[0]}:${params[1]}`;
            const existing = batches.get(key);
            if (existing) {
              // Model PostgreSQL ON CONFLICT semantics closely enough to catch
              // a regression that silently reopens an already-closed batch.
              if (/DO UPDATE SET status = 'started'/i.test(sql)) {
                existing.status = 'started';
                existing.completed_at = null;
                return { rows: [existing] };
              }
              return { rows: [] };
            }
            const row = {
              tenant_id: params[0], batch_id: params[1], status: 'started',
              row_count: 0, accepted_count: 0, rejected_count: 0,
              evidence_hash: null, started_at: params[5], completed_at: null
            };
            batches.set(key, row);
            return { rows: [row] };
          }
          if (sql.startsWith('UPDATE shopee_th_import_batches')) {
            const row = batches.get(`${params[0]}:${params[1]}`);
            if (!row || row.status !== 'started') return { rows: [] };
            row.status = 'completed';
            row.row_count = params[2];
            row.accepted_count = params[3];
            row.rejected_count = params[4];
            row.evidence_hash = params[5] ?? null;
            row.completed_at = params[6];
            return { rows: [row] };
          }
          if (sql.startsWith('SELECT') && sql.includes('shopee_th_import_batches')) {
            const row = batches.get(`${params[0]}:${params[1]}`);
            return row ? { rows: [row] } : { rows: [] };
          }
          return { rows: [] };
        }
      });
    }
  };
}

test('a completed Shopee import batch cannot be silently reopened by replay', async () => {
  const repo = createShopeeThRepo({ db: replayClient(), clock: () => Date.parse('2026-09-19T12:00:00.000Z') });
  await repo.startBatch(TENANT, { batchId: 'shp_replay_1', sourceType: 'product_feed_csv', parserVersion: '1.0.0' });
  await repo.completeBatch(TENANT, {
    batchId: 'shp_replay_1', rowCount: 1, acceptedCount: 1, rejectedCount: 0,
    evidenceHash: 'source-evidence'
  });

  await assert.rejects(
    () => repo.startBatch(TENANT, { batchId: 'shp_replay_1', sourceType: 'product_feed_csv', parserVersion: '1.0.0' }),
    /already closed|completed|replay/i
  );

  const batch = await repo.getBatch(TENANT, 'shp_replay_1');
  assert.equal(batch.status, 'completed');
  assert.equal(batch.rowCount, 1);
  assert.equal(batch.acceptedCount, 1);
  assert.ok(batch.evidenceHash, 'completion evidence remains attached to the closed batch');
});
