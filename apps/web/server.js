import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const files = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/app.js', ['app.js','text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']]
]);

export function applySecurityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
}

export function buildWebServer() {
  return http.createServer(async (req, res) => {
    applySecurityHeaders(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, HEAD' });
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, service: 'zaffiliate-web' }));
    }
    const entry = files.get(req.url || '/');
    if (!entry) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'not_found' }));
    }
    try {
      const [filename, contentType] = entry;
      const body = await readFile(join(publicDir, filename));
      res.writeHead(200, { 'content-type': contentType, 'cache-control': filename === 'index.html' ? 'no-cache' : 'public, max-age=300' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'asset_read_failed' }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.WEB_PORT || 3000);
  buildWebServer().listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'web_started', port })));
}
