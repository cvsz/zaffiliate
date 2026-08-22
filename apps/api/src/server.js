import http from 'node:http';
import { createLogger, MetricsRegistry, traceContext } from '../../../packages/observability/src/index.js';
import { getSupabaseStatus, createSupabaseClient } from '../../../packages/supabase/src/index.js';

const port = Number(process.env.PORT || 8080);
const requiredForReady = ['DATABASE_URL', 'REDIS_URL'];

export function readiness(env = process.env) {
  const missing = requiredForReady.filter((key) => !String(env[key] || '').trim());
  const supabase = getSupabaseStatus(env);
  return Object.freeze({
    ready: missing.length === 0,
    missing,
    supabase
  });
}

export function buildServer({ env = process.env, logger = createLogger(), metrics = new MetricsRegistry() } = {}) {
  return http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint();
    const context = traceContext(req.headers);
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    res.setHeader('x-request-id', context.requestId);
    res.setHeader('x-trace-id', context.traceId);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'no-referrer');

    const finish = (status, route) => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metrics.inc('zaffiliate_http_requests_total', { method: req.method || 'UNKNOWN', route, status });
      metrics.set('zaffiliate_http_last_request_duration_ms', { route }, elapsedMs);
      logger.info('http_request_completed', {
        requestId: context.requestId,
        traceId: context.traceId,
        method: req.method,
        route,
        status,
        durationMs: Math.round(elapsedMs * 1000) / 1000
      });
    };

    const json = (status, route, body) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.writeHead(status);
      res.end(JSON.stringify(body));
      finish(status, route);
    };

    if (req.method === 'GET' && pathname === '/healthz') {
      return json(200, '/healthz', { ok: true, service: 'zaffiliate-api' });
    }

    if (req.method === 'GET' && pathname === '/readyz') {
      const result = readiness(env);
      return json(result.ready ? 200 : 503, '/readyz', result);
    }

    if (req.method === 'GET' && pathname === '/supabase/health') {
      const status = getSupabaseStatus(env);
      return json(status.configured ? 200 : 503, '/supabase/health', status);
    }

    if (req.method === 'GET' && pathname === '/metrics') {
      res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.writeHead(200);
      res.end(metrics.render());
      return finish(200, '/metrics');
    }

    return json(404, 'not_found', { error: 'not_found' });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = createLogger();
  const server = buildServer({ logger });
  const supabase = createSupabaseClient();
  if (supabase) {
    logger.info('supabase_configured', { url: process.env.SUPABASE_URL });
  } else {
    logger.info('supabase_not_configured');
  }
  server.listen(port, '0.0.0.0', () => {
    logger.info('server_started', { port });
  });
}

