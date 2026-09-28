import { resolve4, resolve6 } from 'node:dns/promises';
import tls from 'node:tls';
import { mkdir, writeFile } from 'node:fs/promises';

const target = new URL(process.env.LIVE_SITE_URL || process.argv[2] || 'https://zaff.zeaz.dev/');
if (target.protocol !== 'https:') throw new Error('LIVE_SITE_URL must use https');

async function fetchCheck(path, options = {}) {
  const url = new URL(path, target);
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), ...options });
  return {
    url: url.toString(),
    status: response.status,
    headers: Object.fromEntries([...response.headers.entries()].filter(([k]) => [
      'content-security-policy','strict-transport-security','x-content-type-options','x-frame-options',
      'referrer-policy','cache-control','location','content-type'
    ].includes(k))),
    body: options.method === 'HEAD' ? '' : await response.text()
  };
}

const dns = { a: [], aaaa: [] };
try { dns.a = await resolve4(target.hostname); } catch {}
try { dns.aaaa = await resolve6(target.hostname); } catch {}

const tlsEvidence = await new Promise((resolveTls, reject) => {
  const socket = tls.connect({ host: target.hostname, port: 443, servername: target.hostname, rejectUnauthorized: true }, () => {
    const cert = socket.getPeerCertificate();
    resolveTls({
      authorized: socket.authorized,
      protocol: socket.getProtocol(),
      validFrom: cert.valid_from,
      validTo: cert.valid_to,
      fingerprint256: cert.fingerprint256
    });
    socket.end();
  });
  socket.setTimeout(10000, () => socket.destroy(new Error('tls_timeout')));
  socket.once('error', reject);
});

const root = await fetchCheck('/');
const health = await fetchCheck('/healthz');
const privacy = await fetchCheck('/privacy');
const terms = await fetchCheck('/terms');
const protectedApi = await fetchCheck('/api/ui/overview', {
  headers: { 'x-tenant-id': '11111111-1111-4111-8111-111111111111' }
});

const h = root.headers;
const checks = {
  dns: dns.a.length + dns.aaaa.length > 0,
  tlsAuthorized: tlsEvidence.authorized === true,
  tlsModern: /^TLSv1\.[23]$/.test(tlsEvidence.protocol || ''),
  root200: root.status === 200,
  compiledBundle: !root.body.includes('/src/main.jsx') && /<div id="root"><\/div>/.test(root.body),
  csp: Boolean(h['content-security-policy']),
  hsts: Boolean(h['strict-transport-security']),
  nosniff: h['x-content-type-options'] === 'nosniff',
  frameGuard: Boolean(h['x-frame-options']),
  referrerPolicy: Boolean(h['referrer-policy']),
  health200: health.status === 200,
  privacy200: privacy.status === 200,
  terms200: terms.status === 200,
  unauthenticatedDenied: protectedApi.status === 401
};
const decision = Object.values(checks).every(Boolean) ? 'PASS' : 'BLOCKED';
const evidence = {
  generatedAt: new Date().toISOString(),
  target: target.origin,
  decision,
  dns,
  tls: tlsEvidence,
  checks,
  responses: {
    root: { status: root.status, headers: root.headers },
    health: { status: health.status },
    privacy: { status: privacy.status },
    terms: { status: terms.status },
    protectedApi: { status: protectedApi.status }
  }
};
await mkdir('dist/release-evidence', { recursive: true });
await writeFile('dist/release-evidence/live-site-verification.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
if (decision !== 'PASS') process.exit(1);
