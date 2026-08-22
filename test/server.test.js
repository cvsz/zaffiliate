import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, readiness } from '../apps/api/src/server.js';

test('readiness is fail-closed when dependencies are missing', () => {
  assert.deepEqual(readiness({}), { ready: false, missing: ['DATABASE_URL', 'REDIS_URL'] });
});

test('readiness succeeds when dependencies are configured', () => {
  assert.deepEqual(readiness({ DATABASE_URL: 'postgres://db', REDIS_URL: 'redis://cache' }), { ready: true, missing: [] });
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
