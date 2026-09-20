import test from 'node:test';
import assert from 'node:assert/strict';
import { createAffiliateCoreRepo } from '../packages/db/src/affiliate-core-repo.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-09-20T01:00:00.000Z';

function replayDb() {
  const clicks = new Map();
  const outbox = [];
  return {
    clicks,
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
              offer_runtime_id: 'off_test',
              product_runtime_id: 'prod_test',
              sub_ids: { subid: 'sub-stable' }
            }] };
          }
          if (sql.startsWith('INSERT INTO affiliate_clicks')) {
            const key = `${params[0]}:${params[1]}`;
            if (clicks.has(key)) return { rows: [] };
            const row = { tenantId: params[0], clickId: params[1], touchpoint: params[3], recordedAt: params[4] };
            clicks.set(key, row);
            return { rows: [row] };
          }
          if (sql.startsWith('INSERT INTO affiliate_domain_outbox')) {
            outbox.push({ tenantId: params[0], eventId: params[1], type: params[2], payload: params[3], occurredAt: params[4] });
            return { rows: [] };
          }
          return { rows: [] };
        }
      });
    }
  };
}

const CLICK = Object.freeze({
  linkId: 'lnk_test',
  touchpoint: Object.freeze({
    source: 'shopee',
    medium: 'affiliate',
    occurredAt: '2026-09-19T12:34:56.000Z',
    visitorHash: 'visitor-stable'
  })
});

test('retrying the same attributed click reuses identity and emits one durable outbox event', async () => {
  const db = replayDb();
  const repo = createAffiliateCoreRepo({ db, clock: () => Date.parse(NOW) });

  const first = await repo.recordClick(TENANT, CLICK);
  const second = await repo.recordClick(TENANT, CLICK);

  assert.equal(second.clickId, first.clickId, 'same attribution event must reuse click identity');
  assert.equal(db.clicks.size, 1, 'retry must not create a second durable click');
  assert.equal(db.outbox.filter((event) => event.type === 'click.recorded').length, 1, 'retry must not duplicate click.recorded');
  assert.equal(first.touchpoint.occurredAt, CLICK.touchpoint.occurredAt, 'source-observed touchpoint timestamp must be preserved');
});

test('identical click provenance in another tenant cannot collide with the first tenant', async () => {
  const db = replayDb();
  const repo = createAffiliateCoreRepo({ db, clock: () => Date.parse(NOW) });

  const first = await repo.recordClick(TENANT, CLICK);
  const second = await repo.recordClick(OTHER_TENANT, CLICK);

  assert.notEqual(second.clickId, first.clickId, 'tenant identity must participate in deterministic click identity');
  assert.equal(db.clicks.size, 2);
});
