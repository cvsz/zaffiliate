import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../apps/api/src/server.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('GET /api/v1/version exposes service identity without sensitive data', async (t) => {
  const server = buildServer({ env: { APP_ENV: 'development' } });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/version`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.service, 'zaffiliate-api');
  assert.equal(body.version, pkg.version);
  assert.equal(body.appEnv, 'development');
});

test('unknown routes use the canonical error envelope with matching request id', async (t) => {
  const server = buildServer({ env: { APP_ENV: 'development' } });
  t.after(() => server.close());
  const port = await listen(server);
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/does-not-exist`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'request_id']);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.error.request_id, response.headers.get('x-request-id'));
});

test('invalid production environment fails fast at server construction', () => {
  assert.throws(() => buildServer({ env: { APP_ENV: 'production' } }), /configuration validation failed/i);
});
