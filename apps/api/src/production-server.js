import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { buildServer } from './server.js';
import { createAffiliateRuntimeForEnv } from './runtime-factory.js';
import { createLocalAuthApi } from './auth-api.js';
import { createLocalAuthService, createNoopRecoverySender } from './auth-service.js';
import { createProductionOAuthApi } from './production-oauth-api.js';
import { createOAuthRegistryForEnv } from './oauth-runtime-factory.js';
import { createCampaignApi } from './campaign-api.js';
import { createConversionApi } from './conversion-api.js';
import { createPublicationApi } from './publication-api.js';
import {
  createDbClient,
  createAuthRepo,
  createOAuthRepo,
  createOAuthLoginRepo,
  createCampaignRepo,
  createConversionReconciliationRepo,
  createPublicationJobsRepo
} from '../../../packages/db/src/index.js';
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
  oauthRegistry = null,
  oauthRepository = null,
  oauthLoginRepository = null,
  campaignRepository = null,
  conversionRepository = null,
  publicationRepository = null,
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
  const providerRegistry = oauthRegistry ?? createOAuthRegistryForEnv({ env });
  const oauthApi = createProductionOAuthApi({
    registry: providerRegistry,
    repo: oauthRepository ?? createOAuthRepo({ db: database }),
    loginRepo: oauthLoginRepository ?? createOAuthLoginRepo({ db: database }),
    localAuthService: authService,
    encryptionKey: env.ENCRYPTION_KEY,
    rateLimiter
  });

  // Feature-specific database boundaries are intentionally lazy. Authentication
  // and OAuth must remain available if an unrelated operator surface is absent
  // in an injected test or maintenance runtime.
  let campaignApi = null;
  const getCampaignApi = () => {
    if (!campaignApi) {
      campaignApi = createCampaignApi({
        repo: campaignRepository ?? createCampaignRepo({ db: database }),
        affiliateRuntime,
        localAuthService: authService,
        rateLimiter
      });
    }
    return campaignApi;
  };

  let conversionApi = null;
  const getConversionApi = () => {
    if (!conversionApi) {
      conversionApi = createConversionApi({
        repo: conversionRepository ?? createConversionReconciliationRepo({ db: database }),
        localAuthService: authService,
        rateLimiter
      });
    }
    return conversionApi;
  };

  let publicationApi = null;
  const getPublicationApi = () => {
    if (!publicationApi) {
      const rawClient = { query: (text, params) => database.query(text, params) };
      publicationApi = createPublicationApi({
        repo: publicationRepository ?? createPublicationJobsRepo(rawClient),
        localAuthService: authService,
        rateLimiter
      });
    }
    return publicationApi;
  };

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const isAuth = pathname.startsWith('/api/v1/auth/');
    const isOAuth = pathname.startsWith('/api/v1/oauth/');
    const isCampaign = pathname === '/api/v1/campaigns' || pathname.startsWith('/api/v1/campaigns/');
    const isConversion = pathname === '/api/v1/conversions' || pathname.startsWith('/api/v1/conversions/');
    const isPublication = pathname === '/api/v1/publications' || pathname.startsWith('/api/v1/publications/');
    if (!isAuth && !isOAuth && !isCampaign && !isConversion && !isPublication) {
      inner.emit('request', req, res);
      return;
    }
    try {
      let result;
      if (isAuth) {
        result = await authApi.handle({
          req,
          pathname,
          tenantId: String(req.headers['x-tenant-id'] ?? '').trim()
        });
      } else if (isOAuth) {
        result = await oauthApi.handle({
          req,
          pathname,
          tenantHeader: String(req.headers['x-tenant-id'] ?? '').trim()
        });
      } else if (isCampaign) {
        result = await getCampaignApi().handle({
          req,
          pathname,
          tenantHeader: String(req.headers['x-tenant-id'] ?? '').trim()
        });
      } else if (isConversion) {
        result = await getConversionApi().handle({
          req,
          pathname,
          tenantHeader: String(req.headers['x-tenant-id'] ?? '').trim()
        });
      } else {
        result = await getPublicationApi().handle({
          req,
          pathname,
          tenantHeader: String(req.headers['x-tenant-id'] ?? '').trim()
        });
      }
      if (result) return sendJson(res, result);
      return sendJson(res, { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not found' } } });
    } catch (error) {
      const surface = isOAuth ? 'oauth' : isCampaign ? 'campaign' : isConversion ? 'conversion' : isPublication ? 'publication' : 'auth';
      logger.error(`${surface}_request_failed`, { message: String(error?.message ?? error) });
      return sendJson(res, {
        status: 500,
        body: { error: { code: `${surface.toUpperCase()}_INTERNAL`, message: `unexpected ${surface} failure` } }
      });
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
  server.listen(port, '0.0.0.0', () => logger.info('server_started', { port, auth: 'local+oauth', campaigns: true, conversions: true, publications: true }));
}
