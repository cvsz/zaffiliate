import http from 'node:http';

const port = Number(process.env.PORT || 8080);
const requiredForReady = ['DATABASE_URL', 'REDIS_URL'];

export function readiness(env = process.env) {
  const missing = requiredForReady.filter((key) => !String(env[key] || '').trim());
  return { ready: missing.length === 0, missing };
}

export function buildServer() {
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');

    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200);
      return res.end(JSON.stringify({ ok: true, service: 'zaffiliate-api' }));
    }

    if (req.method === 'GET' && req.url === '/readyz') {
      const result = readiness();
      res.writeHead(result.ready ? 200 : 503);
      return res.end(JSON.stringify(result));
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'server_started', port }));
  });
}
