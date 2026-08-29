import http from 'node:http';
import { buildServer } from '../apps/api/src/server.js';

export function runPostReleaseSmoke({ target = 'http://127.0.0.1:8080' } = {}) {
  const checks = [];
  let passed = true;

  function assert(condition, name) {
    checks.push(Object.freeze({ name, passed: Boolean(condition) }));
    if (!condition) passed = false;
  }

  return new Promise((resolve) => {
    const server = buildServer();
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}`;

      try {
        const health = await fetch(`${base}/healthz`);
        assert(health.status === 200, 'healthz returns 200');
        assert((await health.json()).ok === true, 'healthz body ok');
      } catch (error) {
        assert(false, 'healthz request');
      }

      try {
        const ready = await fetch(`${base}/readyz`);
        assert(ready.status === 200 || ready.status === 503, 'readyz returns 200 or 503');
      } catch (error) {
        assert(false, 'readyz request');
      }

      try {
        const metrics = await fetch(`${base}/metrics`);
        assert(metrics.status === 200, 'metrics returns 200');
        const text = await metrics.text();
        assert(text.includes('zaffiliate_http_requests_total'), 'metrics contains http requests');
      } catch (error) {
        assert(false, 'metrics request');
      }

      server.close();
      const evidence = Object.freeze({ target: base, passed, checks });
      resolve(evidence);
    });
  });
}
