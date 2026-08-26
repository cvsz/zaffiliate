#!/usr/bin/env node
// GM-B8 performance baseline — measures real route latencies against an
// in-process production server build, plus DB reachability latency and a
// short soak. Emits dist/perf-baselines.json. Read-only: no external calls,
// no persistence writes (webhook conversions land in the in-memory runtime).
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { buildServer } from '../apps/api/src/server.js';
import { createAffiliateRuntime } from '../packages/affiliate-core/src/runtime.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../packages/tiktok-shop/src/event-dedupe.js';
import { createInMemorySecretBackend, createSecretManager } from '../packages/security/src/secrets.js';
import { createIngressRateLimiter } from '../packages/security/src/rate-limit-api.js';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function request(base, { method = 'GET', path, headers = {}, body = null } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.request(`${base}${path}`, { method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0 }));
    });
    req.on('error', () => resolve({ status: 0, ms: Date.now() - t0 }));
    if (body != null) req.write(body);
    req.end();
  });
}

async function scenario(name, base, makeCall, { concurrency = 10, durationMs = 4000 } = {}) {
  const latencies = [];
  let requests = 0;
  let errors = 0;
  const start = Date.now();
  let stop = false;
  setTimeout(() => { stop = true; }, durationMs);
  async function worker() {
    while (!stop) {
      const { status, ms } = await makeCall();
      requests += 1;
      latencies.push(ms);
      if (status === 0 || status >= 500) errors += 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedS = (Date.now() - start) / 1000;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const result = {
    scenario: name,
    requests,
    rps: Number((requests / elapsedS).toFixed(1)),
    errorRate: Number((errors / Math.max(1, requests)).toFixed(4)),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0
  };
  console.log(`perf: ${name.padEnd(26)} rps=${String(result.rps).padStart(7)} p50=${result.p50}ms p95=${result.p95}ms p99=${result.p99}ms err=${result.errorRate}`);
  return result;
}

const NOW = new Date('2026-08-25T12:00:00.000Z').getTime();
const clock = () => NOW;
const runtime = createAffiliateRuntime({ clock });
const product = runtime.registerProduct('org-A', { platform: 'tiktok', externalProductId: 'perf-1', title: 'Perf Gadget' });
const offer = runtime.publishOffer('org-A', { productId: product.productId, price: 150000, currency: 'THB', commissionRate: 0.1 });
const link = runtime.generateLink('org-A', { offerId: offer.offerId, destinationUrl: 'https://shop.example.com/p/perf', slug: 'perf-drop' });

const backend = createInMemorySecretBackend();
backend.put('ref:webhooks/shopee', 'shopee-webhook-secret');
const server = buildServer({
  env: { APP_ENV: 'development' },
  runtime,
  webhookGuard: createWebhookReplayGuard({ dedupeStore: createEventDedupeStore(), windowSeconds: 3600 }),
  webhookSecrets: createSecretManager({ backend }),
  rateLimiter: createIngressRateLimiter({ requestsPerMinute: 100000, burst: 100000 })
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`perf: baseline target ${base} (isolated in-process build)`);

let seq = 0;
function webhookCall() {
  seq += 1;
  const rawBody = JSON.stringify({ orderRef: `perf-${seq}`, revenueMinorUnits: 100000, currency: 'THB', subId: link.subIds.subid });
  const ts = String(Date.now());
  return request(base, {
    method: 'POST',
    path: '/webhooks/shopee',
    headers: {
      'x-tenant-id': 'org-A',
      'content-type': 'application/json',
      'x-zaff-signature': `sha256=${createHmac('sha256', 'shopee-webhook-secret').update(`${ts}.${rawBody}`).digest('hex')}`,
      'x-zaff-timestamp': ts,
      'x-zaff-event-id': `perf-evt-${seq}`
    },
    body: rawBody
  });
}

const scenarios = [];
scenarios.push(await scenario('healthz', base, () => request(base, { path: '/healthz' })));
scenarios.push(await scenario('api_version', base, () => request(base, { path: '/api/v1/version' })));
scenarios.push(await scenario('go_redirect', base, () => request(base, { path: '/go/perf-drop', headers: { 'x-tenant-id': 'org-A' } })));
scenarios.push(await scenario('webhook_ingest', base, webhookCall));
scenarios.push(await scenario('analytics_overview', base, () => request(base, { path: '/api/v1/analytics/overview', headers: { 'x-tenant-id': 'org-A' } })));

// §46 saturation responsiveness: hammer webhooks while sampling healthz p95
console.log('perf: saturation probe — webhook flood concurrent with healthz sampling');
let flooding = true;
const flood = (async () => {
  while (flooding) await webhookCall();
})();
const underLoad = await scenario('healthz_under_webhook_flood', base, () => request(base, { path: '/healthz' }), { durationMs: 3000 });
await Promise.resolve();
flooding = false;
await new Promise((r) => setTimeout(r, 50));
await flood;

// §43 database latency (live managed Postgres when configured)
let dbLatencyMs = null;
try {
  const { createDbClient } = await import('../packages/db/src/client.js');
  const db = createDbClient({});
  const status = await db.check();
  dbLatencyMs = status.reachable ? status.latencyMs : null;
  await db.close();
} catch {
  dbLatencyMs = null;
}
console.log(`perf: db_reachable_latency_ms=${dbLatencyMs ?? 'not-configured'}`);

// §43 soak sample
const soak = { durationMs: 15000, samples: 0 };
{
  const samples = [];
  const start = Date.now();
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  while (Date.now() - start < soak.durationMs) {
    const { status } = await request(base, { path: '/healthz' });
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
    samples.push(status === 200);
    await new Promise((r) => setTimeout(r, 250));
  }
  soak.samples = samples.length;
  soak.successRate = Number((samples.filter(Boolean).length / samples.length).toFixed(4));
  soak.memoryGrowthPct = Number((((peakRss - baselineRss) / baselineRss) * 100).toFixed(2));
  console.log(`perf: soak success=${soak.successRate} rssGrowth=${soak.memoryGrowthPct}%`);
}

const evidence = {
  recordedAt: new Date().toISOString(),
  environment: 'isolated in-process server build, node ' + process.version,
  scenarios,
  saturation: { note: 'healthz sampled during continuous webhook ingest flood', ...underLoad },
  databaseReachLatencyMs: dbLatencyMs,
  soak
};
mkdirSync('dist', { recursive: true });
writeFileSync('dist/perf-baselines.json', JSON.stringify(evidence, null, 2));
console.log('perf: wrote dist/perf-baselines.json');
server.close();
