import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrendStore } from '../packages/trend/src/index.js';

test('trend ingestion and opportunity scoring', () => {
  const store = createTrendStore({ now: () => Date.parse('2026-08-30T12:00:00Z') });
  const t = '00000000-0000-4000-8000-000000000001';
  const e = store.ingest({ tenantId: t, keyword: 'summer dress', category: 'fashion', source: 'tiktok', score: 85, volume: 1500 });
  assert.equal(e.keyword, 'summer dress');
  assert.equal(e.score, 85);
  const list = store.listRecent({ tenantId: t });
  assert.equal(list[0].keyword, 'summer dress');
  const opp = store.scoreOpportunity({ tenantId: t, productId: 'prod_1', trendKeyword: 'summer dress', baseScore: 60 });
  assert.equal(opp.trendKeyword, 'summer dress');
  assert.equal(opp.confidence, 'MEDIUM');
  assert.ok(opp.score >= 60);
});

test('trend ingestion validates inputs fail-closed', () => {
  const store = createTrendStore();
  const t = '00000000-0000-4000-8000-000000000001';
  assert.throws(() => store.ingest({ tenantId: t, keyword: '', source: 'tiktok' }), /keyword is required/);
  assert.throws(() => store.ingest({ tenantId: t, keyword: 'x', source: 'unknown' }), /unsupported trend source/);
  assert.throws(() => store.ingest({ tenantId: t, keyword: 'x', source: 'tiktok', score: 200 }), /score must be/);
});

test('trend tenant isolation', () => {
  const store = createTrendStore();
  const a = '00000000-0000-4000-8000-000000000010';
  const b = '00000000-0000-4000-8000-000000000011';
  store.ingest({ tenantId: a, keyword: 'alpha', source: 'tiktok', score: 70 });
  store.ingest({ tenantId: b, keyword: 'beta', source: 'tiktok', score: 90 });
  assert.equal(store.listRecent({ tenantId: a }).length, 1);
  assert.equal(store.listRecent({ tenantId: a })[0].keyword, 'alpha');
  assert.equal(store.listRecent({ tenantId: b })[0].keyword, 'beta');
});

test('opportunity scoring without matching trend returns low confidence', () => {
  const store = createTrendStore();
  const t = '00000000-0000-4000-8000-000000000001';
  const opp = store.scoreOpportunity({ tenantId: t, productId: 'prod_x', trendKeyword: 'nonexistent', baseScore: 40 });
  assert.equal(opp.confidence, 'LOW');
  assert.ok(opp.reasons[0].includes('no matching trend'));
});
