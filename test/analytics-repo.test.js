import test from 'node:test';
import assert from 'node:assert/strict';
import { saveAnalyticsEvents, listRecentAnalyticsEvents } from '../packages/db/src/analytics-repo.js';
import { buildEventEnvelope } from '../packages/analytics/src/events.js';

const NOW = '2026-08-24T12:00:00.000Z';

function envelope(overrides = {}) {
  return buildEventEnvelope({
    organizationId: 'org-A', provider: 'tiktok',
    type: 'affiliate_click_recorded', sourceType: 'FIRST_PARTY',
    occurredAt: NOW, receivedAt: NOW,
    externalEventId: 'ext-1', affiliateLinkId: 'lnk_1',
    payload: { linkId: 'lnk_1' },
    ...overrides
  });
}

function fakeClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(text, params) { calls.push({ text, params }); return { rows }; }
  };
}

test('envelopes persist as parameterized rows with dimensions carrying lineage+payload', async () => {
  const client = fakeClient();
  const env = envelope();
  const saved = await saveAnalyticsEvents(client, 'org-A', [env]);
  assert.equal(saved.inserted, 1);
  const { text, params } = client.calls[0];
  assert.match(text, /INSERT INTO analytics_events/i);
  assert.match(text, /RETURNING|VALUES/i);
  assert.equal(params[0], 'org-A');
  assert.equal(params[1], env.eventId);
  assert.equal(params[2], env.eventType);
  const dimensions = JSON.parse(params[5]);
  assert.equal(dimensions.lineage.affiliate_link_id, 'lnk_1');
});

test('empty batches issue no queries', () => {
  const client = fakeClient();
  saveAnalyticsEvents(client, 'org-A', []);
  assert.equal(client.calls.length, 0);
});

test('duplicate deliveries are deduped before any database round-trip', async () => {
  const client = fakeClient();
  const env = envelope();
  await saveAnalyticsEvents(client, 'org-A', [env, env]);
  assert.equal(client.calls[0].params.length >= 6, true);
  assert.equal(client.calls.length, 1, 'single multi-row insert, no duplicate rows');
});

test('cross-call redelivery degrades to zero-row insert instead of constraint crash', async () => {
  const env = envelope();
  const first = fakeClient();
  first.query = async (text, params) => { first.calls.push({ text, params }); return { rows: [], rowCount: 1 }; };
  const initial = await saveAnalyticsEvents(first, 'org-A', [env]);
  assert.equal(initial.inserted, 1);
  assert.match(first.calls[0].text, /ON CONFLICT \(tenant_id, event_id\) DO NOTHING/i);

  const replay = fakeClient();
  replay.query = async (text, params) => { replay.calls.push({ text, params }); return { rows: [], rowCount: 0 }; };
  const saved = await saveAnalyticsEvents(replay, 'org-A', [env]);
  assert.equal(saved.inserted, 0, 'redelivered event must report zero inserted');
  assert.match(replay.calls[0].text, /ON CONFLICT \(tenant_id, event_id\) DO NOTHING/i);
});

test('listRecent maps rows back into envelope-shaped records', async () => {
  const client = fakeClient([{
    event_id: 'evt_x', event_type: 'impression_recorded',
    occurred_at: NOW, received_at: NOW, dimensions: { lineage: {} }, measures: {}
  }]);
  const rows = await listRecentAnalyticsEvents(client, 'org-A', 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventId, 'evt_x');
  assert.equal(rows[0].eventType, 'impression_recorded');
});
