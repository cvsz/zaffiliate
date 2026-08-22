import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../apps/api/src/server.js';
import { buildWebServer } from '../apps/web/server.js';
import { once } from 'node:events';

test('e2e smoke: API and web server integration', async (t) => {
  const apiServer = buildServer();
  apiServer.listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  const apiPort = apiServer.address().port;

  const webServer = buildWebServer();
  webServer.listen(0, '127.0.0.1');
  await once(webServer, 'listening');
  const webPort = webServer.address().port;

  t.after(async () => {
    apiServer.close();
    await once(apiServer, 'close');
    webServer.close();
    await once(webServer, 'close');
  });

  const apiBase = `http://127.0.0.1:${apiPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;

  const healthz = await fetch(`${apiBase}/healthz`);
  assert.equal(healthz.status, 200);
  assert.deepEqual(await healthz.json(), { ok: true, service: 'zaffiliate-api' });

  const readyz = await fetch(`${apiBase}/readyz`);
  assert.ok(readyz.status === 200 || readyz.status === 503);

  const metrics = await fetch(`${apiBase}/metrics`);
  assert.equal(metrics.status, 200);
  assert.ok((await metrics.text()).includes('zaffiliate_http_requests_total'));

  const root = await fetch(`${webBase}/`);
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.ok(html.includes('<title>') || html.includes('<nav'));

  const nav = await fetch(`${webBase}/api/navigation`, { headers: { 'x-tenant-id': 'test' } });
  assert.equal(nav.status, 200);
  assert.ok(Array.isArray((await nav.json()).sections));

  const audit = await fetch(`${webBase}/api/audit`, { headers: { 'x-tenant-id': 'test' } });
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray((await audit.json()).rows));

  const crossOrigin = await fetch(`${apiBase}/healthz`, { headers: { Origin: webBase } });
  assert.equal(crossOrigin.headers.get('access-control-allow-origin'), null, 'cross-origin requests must be blocked');
});
