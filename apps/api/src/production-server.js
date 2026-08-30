import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildServer } from './server.js';
import { createAffiliateRuntimeForEnv } from './runtime-factory.js';
import { createLocalAuthApi } from './auth-api.js';
import { createLocalAuthService, createNoopRecoverySender } from './auth-service.js';
import { createDbClient, createAuthRepo } from '../../../packages/db/src/index.js';
import { createIngressRateLimiter } from '../../../packages/security/src/rate-limit-api.js';
import { createLogger } from '../../../packages/observability/src/index.js';

function sendJson(res, result) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-request-id', randomUUID());
  for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
  res.writeHead(result.status);
  res.end(JSON.stringify(result.body));
}

export function createProductionServer({
  env = process.env,
  logger = createLogger(),
  runtime = null,
  localAuthService = null,
  rateLimiter = createIngressRateLimiter({ requestsPerMinute: 120, burst: 60 }),
  db = null
} = {}) {
  const affiliateRuntime = runtime ?? createAffiliateRuntimeForEnv({ env, logger });
  const inner = buildServer({ env, logger, runtime: affiliateRuntime, rateLimiter });
  const database = db ?? createDbClient({ connectionString: env.DATABASE_URL || null, logger });
  const authService = localAuthService ?? createLocalAuthService({
    repo: createAuthRepo({ db: database }),
    sender: createNoopRecoverySender({ logger })
  });
  const authApi = createLocalAuthApi({ service: authService, rateLimiter });

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (!pathname.startsWith('/api/v1/auth/')) {
      inner.emit('request', req, res);
      return;
    }
    try {
      const result = await authApi.handle({
        req,
        pathname,
        tenantId: String(req.headers['x-tenant-id'] ?? '').trim()
      });
      if (result) return sendJson(res, result);
      return sendJson(res, { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } });
    } catch (error) {
      logger.error('auth_request_failed', { message: String(error?.message ?? error) });
      return sendJson(res, { status: 500, body: { error: { code: 'AUTH_INTERNAL', message: 'unexpected authentication failure' } } });
    }
  });

  const close = server.close.bind(server);
  server.close = (callback) => close(async (error) => {
    try {
      if (!db && typeof database.close === 'function') await database.close();
    } catch (closeError) {
      logger.error('auth_db_close_failed', { message: String(closeError?.message ?? closeError) });
    }
    if (typeof callback === 'function') callback(error);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const logger = createLogger();
  const server = createProductionServer({ env: process.env, logger });
  const port = Number(process.env.PORT || 8080);
  server.listen(port, '0.0.0.0', () => logger.info('server_started', { port, auth: 'local+oauth' }));
}
