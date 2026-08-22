import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, createLogRecord, MetricsRegistry, traceContext } from '../packages/observability/src/index.js';
import { buildServer } from '../apps/api/src/server.js';

test('structured log redaction removes nested secret material', () => {
  const record = createLogRecord('info', 'example', {
    tenantId: 't1',
    authorization: 'Bearer secret',
    nested: { apiKey: 'key', safe: 'value' }
  }, new Date('2026-08-22T00:00:00Z'));
  assert.equal(record.authorization, '[REDACTED]');
  assert.equal(record.nested.apiKey, '[REDACTED]');
  assert.equal(record.nested.safe, 'value');
  assert.equal(redact('hello', 'password'), '[REDACTED]');
});

test('trace context preserves bounded caller IDs and generates missing IDs', () => {
  const supplied = traceContext({ 'x-request-id': 'req-1', 'x-trace-id': 'trace-1' });
  assert.equal(supplied.requestId, 'req-1');
  assert.equal(supplied.traceId, 'trace-1');
  const generated = traceContext({});
  assert.ok(generated.requestId.length > 0);
  assert.ok(generated.traceId.length > 0);
});

test('metrics registry emits deterministic Prometheus-style output', () => {
  const metrics = new MetricsRegistry();
  metrics.inc('requests_total', { route: '/x', status: 200 });
  metrics.inc('requests_total', { route: '/x', status: 200 });
  metrics.set('queue_depth', { queue: 'jobs' }, 3);
  const text = metrics.render();
  assert.match(text, /requests_total\{route="\/x",status="200"\} 2/);
  assert.match(text, /queue_depth\{queue="jobs"\} 3/);
});

test('API exposes correlation headers and instrumented metrics without secrets', async (t) => {
  const logs = [];
  const logger = { info: (event, fields) => logs.push({ event, fields }), warn() {}, error() {} };
  const metrics = new MetricsRegistry();
  const server = buildServer({ env: { DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache' }, logger, metrics });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'x-request-id': 'request-test', 'x-trace-id': 'trace-test' } });
  assert.equal(health.headers.get('x-request-id'), 'request-test');
  assert.equal(health.headers.get('x-trace-id'), 'trace-test');
  const response = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /zaffiliate_http_requests_total/);
  assert.equal(logs.some((entry) => entry.event === 'http_request_completed'), true);
});
