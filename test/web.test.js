import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildWebServer } from '../apps/web/server.js';

async function withServer(fn) {
  const server = buildWebServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('web shell serves HTML with strict browser security headers', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const html = await response.text();
    assert.match(html, /zaffiliate Control Plane/);
  });
});

test('web health endpoint and method restrictions are explicit', async () => {
  await withServer(async (base) => {
    const health = await fetch(`${base}/healthz`);
    assert.deepEqual(await health.json(), { ok: true, service: 'zaffiliate-web' });
    const post = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(post.status, 405);
  });
});
