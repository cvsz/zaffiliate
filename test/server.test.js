import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, readiness } from '../apps/api/src/server.js';

test('readiness is fail-closed when dependencies are missing', () => {
  const result = readiness({});
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, ['DATABASE_URL', 'REDIS_URL']);
  assert.ok(result.supabase);
});

test('readiness succeeds when dependencies are configured', () => {
  const result = readiness({ DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache' });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.ok(result.supabase);
});

test('health endpoint returns 200', async (t) => {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'zaffiliate-api' });
});
