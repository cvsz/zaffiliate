import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLogger, MetricsRegistry, traceContext } from '../../../packages/observability/src/index.js';
import { getSupabaseStatus, createSupabaseClient } from '../../../packages/supabase/src/index.js';
import { createAffiliateRuntime } from '../../../packages/affiliate-core/src/runtime.js';
import { createEventDedupeStore, createWebhookReplayGuard } from '../../../packages/tiktok-shop/src/event-dedupe.js';
import { createInMemorySecretBackend, createSecretManager } from '../../../packages/security/src/secrets.js';
import { loadConfig } from '../../../packages/config/src/index.js';
import { createIngressRateLimiter } from '../../../packages/security/src/rate-limit-api.js';
import { createSecurityEventRecorder } from '../../../packages/security/src/security-events.js';
import { OAuthTokenError } from '../../../packages/security/src/oauth.js';
import { resolveRedirect, ingestWebhook } from './business.js';
import { createFeatureApi } from './features-api.js';
import { createCommerceStore } from '../../../packages/affiliate-core/src/commerce.js';
import { createEventStore } from '../../../packages/analytics/src/events.js';
import { createFeatureStore, defineBaselineRanker } from '../../../packages/intelligence/src/index.js';
import { createRecommendationStore, createPredictionStore } from '../../../packages/intelligence/src/stores.js';
import { createRecommendationService } from '../../../packages/intelligence/src/pipeline.js';

const port = Number(process.env.PORT || 8080);
const requiredForReady = ['DATABASE_URL', 'REDIS_URL'];
const packageManifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

export function readiness(env = process.env) {
  const missing = requiredForReady.filter((key) => !String(env[key] || '').trim());
  const supabase = getSupabaseStatus(env);
  return Object.freeze({
    ready: missing.length === 0,
    missing,
    supabase
  });
}

function defaultWebhookSecrets() {
  return createSecretManager({ backend: createInMemorySecretBackend() });
}

export function buildServer({
  env = process.env,
  logger = createLogger(),
  metrics = new MetricsRegistry(),
  runtime = createAffiliateRuntime(),
  webhookGuard = createWebhookReplayGuard({ dedupeStore: createEventDedupeStore() }),
  webhookSecrets = defaultWebhookSecrets(),
  rateLimiter = createIngressRateLimiter({ requestsPerMinute: 120, burst: 60 }),
  securityEvents = null,
  commerceStore = createCommerceStore(),
  analyticsEvents = createEventStore(),
  featureStore = createFeatureStore(),
  recommendationStore = createRecommendationStore(),
  predictionStore = createPredictionStore(),
  policyOverrides = {},
  oauthRegistry = null,
  identityRuntime = null,
  nowMs = Date.now
} = {}) {
  const config = loadConfig(env);
  const visitorSalt = config.visitorSalt || randomBytes(16).toString('hex');
  const featureApi = createFeatureApi({
    commerceStore,
    analyticsEvents,
    recommendationService: createRecommendationService({
      featureStore, recommendationStore, predictionStore, ranker: defineBaselineRanker({ featureStore })
    }),
    recommendationStore,
    automationDefaults: policyOverrides
  });
  const events = securityEvents ?? createSecurityEventRecorder({});
  const oauthPending = new Map();
  return http.createServer(async (req, res) => {
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

    const json = (status, route, body, _unused, extraHeaders = {}) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
      res.writeHead(status);
      res.end(JSON.stringify(body));
      finish(status, route);
    };

    const errorEnvelope = (status, route, code, message) => {
      return json(status, route, { error: { code, message, request_id: context.requestId } });
    };

    const throttled = (route) => {
      return json(429, route, { error: { code: 'RATE_LIMITED', message: 'too many requests', request_id: context.requestId } }, undefined, { 'retry-after': '1' });
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

    const tenantHeader = String(req.headers['x-tenant-id'] ?? '').trim();
    const FEATURE_PREFIXES = ['/api/v1/commerce/', '/api/v1/intelligence/', '/api/v1/analytics/', '/api/v1/automation/', '/api/v1/content/'];
    const isFeaturePath = FEATURE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (isFeaturePath) {
      if (!tenantHeader) {
        return json(400, 'features', { error: { code: 'TENANT_HEADER_REQUIRED', message: 'x-tenant-id header is required', request_id: context.requestId } });
      }
      let parsedBody = null;
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks = [];
        let size = 0;
        let overflow = false;
        await new Promise((resolveBody, rejectBody) => {
          req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 65536) { overflow = true; chunks.length = 0; req.resume(); resolveBody(''); return; }
            if (!overflow) chunks.push(chunk);
          });
          req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
          req.on('error', rejectBody);
        });
        if (overflow) {
          return json(413, pathname, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body exceeds 64KB', request_id: context.requestId } });
        }
        try { parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch { return json(400, pathname, { error: { code: 'INVALID_JSON', message: 'body must be valid JSON', request_id: context.requestId } }); }
      }
      const featureResult = await featureApi.handle(pathname, req.method, tenantHeader, {
        body: parsedBody
      });
      if (featureResult) {
        return json(featureResult.status, pathname, featureResult.body ?? featureResult.error ?? { ok: true });
      }
    }

    if (req.method === 'GET' && pathname === '/api/v1/version') {
      return json(200, '/api/v1/version', {
        service: 'zaffiliate-api',
        version: packageManifest.version,
        appEnv: config.appEnv
      });
    }

    const oauthAuthorizeMatch = req.method === 'GET' ? pathname.match(/^\/api\/v1\/oauth\/([a-z0-9_-]{2,32})\/authorize$/) : null;
    const oauthCallbackMatch = req.method === 'GET' ? pathname.match(/^\/api\/v1\/oauth\/([a-z0-9_-]{2,32})\/callback$/) : null;
    if (oauthAuthorizeMatch || oauthCallbackMatch) {
      const route = '/api/v1/oauth/:provider/:action';
      const providerId = (oauthAuthorizeMatch ?? oauthCallbackMatch)[1];
      if (!oauthRegistry || !(oauthRegistry instanceof Map) || !oauthRegistry.has(providerId)) {
        return json(503, route, { error: { code: 'OAUTH_NOT_CONFIGURED', message: 'no oauth flow registered for provider', request_id: context.requestId } });
      }
      if (!identityRuntime || typeof identityRuntime.linkExternalIdentity !== 'function') {
        return json(500, route, { error: { code: 'OAUTH_MISCONFIGURED', message: 'identity runtime unavailable', request_id: context.requestId } });
      }
      const entry = oauthRegistry.get(providerId);
      const url = new URL(req.url || '/', 'http://localhost');
      if (oauthAuthorizeMatch) {
        const userId = String(url.searchParams.get('userId') ?? '').trim();
        if (!userId) return json(400, route, { error: { code: 'USER_ID_REQUIRED', message: 'userId query parameter is required', request_id: context.requestId } });
        const authorization = entry.flow.createAuthorization();
        const stateTtlMs = 10 * 60 * 1000;
        oauthPending.set(authorization.state, {
          provider: entry.flow.provider,
          flow: entry.flow,
          tokenStore: entry.tokenStore,
          issuer: entry.issuer ?? `https://oauth.${entry.flow.provider}`,
          subjectHint: entry.subjectHint ?? null,
          userId,
          codeVerifier: authorization.codeVerifier,
          expiresAt: nowMs() + stateTtlMs
        });
        return json(302, route, { authorizeUrl: authorization.url, state: authorization.state, expiresAt: nowMs() + stateTtlMs });
      }
      const state = String(url.searchParams.get('state') ?? '');
      const code = String(url.searchParams.get('code') ?? '');
      const pending = oauthPending.get(state);
      if (!pending) {
        return json(400, route, { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used state', request_id: context.requestId } });
      }
      oauthPending.delete(state);
      if (pending.expiresAt <= nowMs()) {
        return json(400, route, { error: { code: 'INVALID_OAUTH_STATE', message: 'authorization window expired', request_id: context.requestId } });
      }
      let tokens;
      try {
        tokens = await pending.flow.exchangeCode({ authorization: { state, codeVerifier: pending.codeVerifier, expiresAt: pending.expiresAt }, code });
      } catch (error) {
        const reason = error instanceof OAuthTokenError ? error.reason : 'exchange_failed';
        return json(502, route, { error: { code: 'OAUTH_EXCHANGE_FAILED', message: reason, request_id: context.requestId } });
      }
      const issuerSubject = String(tokens.providerAccountId ?? pending.subjectHint ?? `sub:${pending.userId}`);
      try {
        identityRuntime.linkExternalIdentity({ userId: pending.userId, issuer: pending.issuer, issuerSubject });
      } catch (error) {
        if (/already linked/i.test(String(error.message))) {
          return json(409, route, { error: { code: 'IDENTITY_ALREADY_LINKED', message: 'external identity already bound to another user', request_id: context.requestId } });
        }
        return json(400, route, { error: { code: 'IDENTITY_LINK_FAILED', message: 'user not found for oauth link', request_id: context.requestId } });
      }
      pending.tokenStore.store(tokens);
      events.record({ type: 'OAUTH_LINK_COMPLETED', severity: 'LOW', resource: `/api/v1/oauth/${pending.provider}/callback`, reason: `identity ${pending.userId} linked via ${pending.provider}`, tenantId: pending.userId });
      return json(200, route, { linked: true, provider: pending.provider, expiresAt: tokens.expiresAt });
    }

    const goMatch = req.method === 'GET' ? pathname.match(/^\/go\/([A-Za-z0-9-]{1,128})$/) : null;
    if (goMatch) {
      const tenantId = String(req.headers['x-tenant-id'] || '').trim();
      if (!tenantId) return json(404, '/go/:slug', { error: 'not_found' });
      const visitorHash = createHash('sha256')
        .update(`${visitorSalt}:${req.socket.remoteAddress || ''}:${req.headers['user-agent'] || ''}`)
        .digest('hex')
        .slice(0, 32);
      const limitKey = `go:${tenantId}:${req.socket.remoteAddress ?? ''}`;
      const limit = await rateLimiter.tryAcquire(limitKey);
      if (!limit.allowed) {
        events.record({ type: 'RATE_LIMITED', severity: 'LOW', resource: limitKey, reason: `redirect burst exceeded (retry in ${limit.retryAfterMs}ms)`, tenantId });
        return throttled('/go/:slug');
      }
      const decision = resolveRedirect({ runtime, tenantId, slug: decodeURIComponent(goMatch[1]), now: Date.now(), visitorHash });
      if (decision.status === 302) {
        res.setHeader('location', decision.location);
        res.setHeader('cache-control', 'no-store');
      }
      return json(decision.status, '/go/:slug', decision.body ?? { ok: true, clickId: decision.clickId });
    }

    const webhookMatch = req.method === 'POST' ? pathname.match(/^\/webhooks\/([a-z]+)$/) : null;
    if (webhookMatch) {
      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          aborted = true;
          json(413, '/webhooks/:platform', { error: 'payload_too_large' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        try {
          if (aborted) return;
          const rawBody = Buffer.concat(chunks).toString('utf8');
          const tenantId = String(req.headers['x-tenant-id'] || '').trim();
          if (!tenantId) return json(404, '/webhooks/:platform', { error: 'not_found' });
          const limitKey = `webhook:${tenantId}:${webhookMatch[1]}`;
          const limit = await rateLimiter.tryAcquire(limitKey);
          if (!limit.allowed) {
            events.record({ type: 'RATE_LIMITED', severity: 'MEDIUM', resource: limitKey, reason: `webhook burst exceeded (retry in ${limit.retryAfterMs}ms)`, tenantId });
            return json(429, '/webhooks/:platform', { error: { code: 'RATE_LIMITED', message: 'too many requests', request_id: context.requestId } }, false, { 'retry-after': String(Math.ceil(limit.retryAfterMs / 1000) || 1) });
          }
          const result = ingestWebhook({
            runtime,
            guard: webhookGuard,
            secrets: webhookSecrets,
            platform: webhookMatch[1],
            tenantId,
            rawBody,
            signature: req.headers['x-zaff-signature'],
            timestamp: req.headers['x-zaff-timestamp'],
            eventId: req.headers['x-zaff-event-id'],
            now: Date.now()
          });
          if (result.status === 401) {
            events.record({ type: 'WEBHOOK_SIGNATURE_FAILURE', severity: 'MEDIUM', resource: `/webhooks/${webhookMatch[1]}`, reason: result.body?.reason ?? 'invalid signature', tenantId });
          }
          return json(result.status, '/webhooks/:platform', result.body ?? { error: 'webhook_failed' });
        } catch (error) {
          logger.error('webhook_processing_failed', { requestId: context.requestId, message: String(error?.message ?? error) });
          return json(500, '/webhooks/:platform', { error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'unexpected failure while processing delivery', request_id: context.requestId } });
        }
      });
      return undefined;
    }

    return errorEnvelope(404, 'not_found', 'NOT_FOUND', 'not_found');
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

