import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolveRedirectAsync, ingestWebhookAsync } from '../apps/api/src/business-async.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../packages/tiktok-shop/src/event-dedupe.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';

const TENANT = '00000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-08-30T12:00:00.000Z').getTime();

function signed(secret, rawBody, timestamp) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

test('async redirect awaits repository lookup and click persistence', async () => {
  const calls = [];
  const runtime = {
    async resolveLinkBySlug(tenantId, slug) {
      calls.push(['resolve', tenantId, slug]);
      return { linkId: 'lnk_1', deepLinkUrl: 'https://shop.example.test/item?subid=abc', expiresAt: null };
    },
    async recordClick(tenantId, input) {
      calls.push(['click', tenantId, input.linkId]);
      return { clickId: 'clk_1' };
    }
  };
  const result = await resolveRedirectAsync({ runtime, tenantId: TENANT, slug: 'summer', now: NOW, visitorHash: 'abcd1234abcd1234' });
  assert.equal(result.status, 302);
  assert.equal(result.clickId, 'clk_1');
  assert.equal(result.location, 'https://shop.example.test/item?subid=abc');
  assert.deepEqual(calls.map(([name]) => name), ['resolve', 'click']);
});

test('async redirect fails closed when repository lookup rejects', async () => {
  const runtime = {
    async resolveLinkBySlug() { throw new Error('database unavailable'); },
    async recordClick() { throw new Error('must not be called'); }
  };
  const result = await resolveRedirectAsync({ runtime, tenantId: TENANT, slug: 'summer', now: NOW });
  assert.equal(result.status, 404);
});

test('async webhook awaits link lookup and durable conversion write', async () => {
  const rawBody = JSON.stringify({ orderRef: 'order-1', revenueMinorUnits: 10000, currency: 'THB', subId: 'sub-1' });
  const backend = createInMemorySecretBackend();
  backend.put('ref:webhooks/shopee', 'shopee-secret');
  const secrets = createSecretManager({ backend });
  const guard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore({ now: () => NOW }), windowSeconds: 300 });
  const calls = [];
  const runtime = {
    async findLinkBySubId(tenantId, subId) {
      calls.push(['find', tenantId, subId]);
      return { linkId: 'lnk_1' };
    },
    async resolveLinkById() { return null; },
    async recordConversion(tenantId, input) {
      calls.push(['conversion', tenantId, input.orderRef]);
      return { conversionId: 'cnv_1' };
    }
  };
  const result = await ingestWebhookAsync({
    runtime,
    guard,
    secrets,
    platform: 'shopee',
    tenantId: TENANT,
    rawBody,
    signature: signed('shopee-secret', rawBody, String(NOW)),
    timestamp: String(NOW),
    eventId: 'evt-async-1',
    now: NOW
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.conversionId, 'cnv_1');
  assert.deepEqual(calls.map(([name]) => name), ['find', 'conversion']);
});
