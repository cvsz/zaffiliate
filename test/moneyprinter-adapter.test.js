import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoneyPrinterAdapter } from '../packages/adapters/src/moneyprinter.js';

test('MoneyPrinter adapter submits a tenant-scoped approved video job without leaking its key', async () => {
  let observed;
  const adapter = createMoneyPrinterAdapter({
    baseUrl: 'http://moneyprinter:8080', apiKey: 'server-only-secret',
    transport: async (url, init) => {
      observed = { url, init };
      return { ok: true, status: 200, json: async () => ({ data: { task_id: 'task-12345678', state: 'processing' } }) };
    }
  });
  const result = await adapter.createVideo({ tenantId: 'tenant-a', subject: 'สินค้าไทย', approvalRef: 'approval-1', idempotencyKey: 'idem-1' });
  assert.equal(result.taskId, 'task-12345678');
  assert.equal(observed.url, 'http://moneyprinter:8080/api/v1/videos');
  assert.equal(observed.init.headers['x-api-key'], 'server-only-secret');
  assert.equal(JSON.parse(observed.init.body).video_subject, 'สินค้าไทย');
  assert.equal(JSON.stringify(result).includes('server-only-secret'), false);
});

test('MoneyPrinter adapter fails closed without approval and validates task ids', async () => {
  const adapter = createMoneyPrinterAdapter({ baseUrl: 'http://moneyprinter:8080', apiKey: 'secret', transport: async () => assert.fail('must not call transport') });
  await assert.rejects(() => adapter.createVideo({ tenantId: 'tenant-a', subject: 'x', idempotencyKey: 'i' }), /approvalRef is required/);
  await assert.rejects(() => adapter.getTask({ tenantId: 'tenant-a', taskId: '../secrets' }), /invalid format/);
});

test('MoneyPrinter adapter marks throttling and upstream failures retryable', async () => {
  const adapter = createMoneyPrinterAdapter({
    baseUrl: 'https://video.example.com', apiKey: 'secret',
    transport: async () => ({ ok: false, status: 429, json: async () => ({ error: 'limited' }) })
  });
  await assert.rejects(
    () => adapter.createVideo({ tenantId: 'tenant-a', subject: 'campaign', approvalRef: 'a', idempotencyKey: 'i' }),
    (error) => error.name === 'MoneyPrinterProviderError' && error.retryable === true
  );
});

