import { createHash, randomBytes } from 'node:crypto';
import {
  generatePkceBundle,
  generateOAuthState,
  buildTikTokAuthorizationUrl,
  exchangeTikTokCode,
  fetchTikTokUserInfo,
  DEFAULT_TIKTOK_SCOPES,
  TikTokOAuthError
} from '../../../packages/tiktok-developer/src/index.js';
import { encryptSecret, decryptSecret } from '../../../packages/security/src/secret-envelope.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const WRITE_ROLES = new Set(['owner', 'admin']);
const STATE_PREFIX = 'tt_';

function tenantId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) {
    const error = new Error('valid UUID x-tenant-id header is required');
    error.status = 400;
    error.code = 'TENANT_HEADER_INVALID';
    throw error;
  }
  return id;
}

function bearerToken(headers = {}) {
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization ?? ''));
  return m ? m[1].trim() : '';
}

function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function pendingAad(tenant, hash) {
  return `zaffiliate:tiktok:pending:${tenant}:${hash}`;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BODY_BYTES) {
      const e = new Error('request body too large');
      e.status = 413;
      e.code = 'BODY_TOO_LARGE';
      throw e;
    }
    chunks.push(b);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('object required');
    return v;
  } catch {
    const e = new Error('request body must be a JSON object');
    e.status = 400;
    e.code = 'INVALID_JSON';
    throw e;
  }
}

async function limited(rateLimiter, key) {
  const verdict = await rateLimiter.tryAcquire(key);
  if (verdict.allowed) return null;
  return {
    status: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
    headers: {
      'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1),
      'cache-control': 'no-store'
    }
  };
}

function safeAccountView(account) {
  if (!account) return null;
  return {
    id: account.id,
    tenantId: account.tenantId,
    userId: account.userId,
    openId: account.openId,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    status: account.status,
    scope: account.scope,
    tokenExpiresAt: account.tokenExpiresAt,
    refreshExpiresAt: account.refreshExpiresAt,
    lastSyncAt: account.lastSyncAt,
    lastSuccessfulApiCallAt: account.lastSuccessfulApiCallAt,
    lastError: account.lastError,
    tokenVersion: account.tokenVersion,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export function createTikTokApi({
  accountsRepo,
  tokenService,
  oauthRepo,
  publicationJobsRepo = null,
  localAuthService,
  rateLimiter,
  clientKey,
  clientSecret,
  redirectUri,
  scopes = DEFAULT_TIKTOK_SCOPES,
  encryptionKey,
  environment = 'development',
  transport = fetch,
  clock = Date.now
} = {}) {
  if (!accountsRepo || typeof accountsRepo.upsertAccount !== 'function') throw new TypeError('accountsRepo is required');
  if (!tokenService || typeof tokenService.getValidAccessToken !== 'function') throw new TypeError('tokenService is required');
  if (!oauthRepo || typeof oauthRepo.createPendingAuthorization !== 'function') throw new TypeError('oauthRepo is required');
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('localAuthService is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rateLimiter is required');

  const cKey = String(clientKey ?? '').trim();
  const cSecret = String(clientSecret ?? '').trim();
  const redUri = String(redirectUri ?? '').trim();
  const key = String(encryptionKey ?? '').trim();

  async function authenticate(req, scopedTenant) {
    const token = bearerToken(req.headers);
    if (!token) return null;
    return localAuthService.getSession({ tenantId: scopedTenant, token });
  }

  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!String(pathname ?? '').startsWith('/api/v1/tiktok')) return null;

      const method = String(req.method ?? 'GET').toUpperCase();
      const ip = String(req?.socket?.remoteAddress ?? 'unknown');
      const url = new URL(req.url || pathname || '/', 'http://localhost');

      // Health endpoint (accessible for monitoring and probe)
      if (pathname === '/api/v1/tiktok/health' && method === 'GET') {
        const configured = Boolean(cKey && cSecret && redUri);
        return {
          status: 200,
          body: {
            service: 'tiktok-developer',
            status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
            environment,
            features: {
              oauth: configured,
              publishing: configured,
              tokenEncryption: key.length >= 32
            },
            verifiedAt: new Date(clock()).toISOString()
          },
          headers: { 'cache-control': 'no-store' }
        };
      }

      // OAuth start / authorize: GET /api/v1/tiktok/auth/authorize
      if (pathname === '/api/v1/tiktok/auth/authorize') {
        if (method !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
        if (!cKey || !cSecret || !redUri) {
          return { status: 503, body: { error: { code: 'TIKTOK_NOT_CONFIGURED', message: 'TikTok Developer credentials are not configured' } }, headers: { 'cache-control': 'no-store' } };
        }
        if (key.length < 32) {
          return { status: 500, body: { error: { code: 'ENCRYPTION_KEY_REQUIRED', message: 'ENCRYPTION_KEY must be at least 32 characters' } }, headers: { 'cache-control': 'no-store' } };
        }

        const scopedTenant = tenantId(tenantHeader);
        const session = await authenticate(req, scopedTenant);
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };

        const actorId = session.user?.userId;
        const throttled = await limited(rateLimiter, `tiktok:authorize:${scopedTenant}:${actorId}:${ip}`);
        if (throttled) return throttled;

        const pkce = generatePkceBundle();
        const rawState = generateOAuthState();
        const boundState = `${scopedTenant}.${rawState}`;
        const hash = sha256Hex(boundState);

        const verifierCiphertext = encryptSecret(pkce.codeVerifier, {
          key,
          aad: pendingAad(scopedTenant, hash)
        });

        const expiresAt = new Date(clock() + 10 * 60 * 1000); // 10 min TTL
        await oauthRepo.createPendingAuthorization({
          tenantId: scopedTenant,
          userId: actorId,
          provider: 'tiktok',
          issuer: 'https://open.tiktokapis.com',
          stateHash: hash,
          codeVerifierCiphertext: verifierCiphertext,
          expiresAt
        });

        const authorizeUrl = buildTikTokAuthorizationUrl({
          clientKey: cKey,
          redirectUri: redUri,
          scopes,
          state: boundState,
          codeChallenge: pkce.codeChallenge
        });

        return {
          status: 302,
          body: { authorizeUrl, expiresAt: expiresAt.toISOString() },
          headers: { location: authorizeUrl, 'cache-control': 'no-store' }
        };
      }

      // OAuth callback: GET /api/v1/tiktok/auth/callback
      if (pathname === '/api/v1/tiktok/auth/callback') {
        if (method !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };

        const stateParam = String(url.searchParams.get('state') ?? '');
        const codeParam = String(url.searchParams.get('code') ?? '');
        const errorParam = url.searchParams.get('error');

        if (errorParam) {
          return {
            status: 400,
            body: { error: { code: 'OAUTH_DENIED', message: `TikTok authorization denied: ${errorParam}` } },
            headers: { 'cache-control': 'no-store' }
          };
        }

        const dot = stateParam.indexOf('.');
        if (dot !== 36) {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, malformed or expired oauth state' } }, headers: { 'cache-control': 'no-store' } };
        }

        const scopedTenant = stateParam.slice(0, dot).toLowerCase();
        if (!UUID_PATTERN.test(scopedTenant) || !codeParam) {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'invalid tenant or authorization code' } }, headers: { 'cache-control': 'no-store' } };
        }

        const throttled = await limited(rateLimiter, `tiktok:callback:${scopedTenant}:${ip}`);
        if (throttled) return throttled;

        const hash = sha256Hex(stateParam);
        const pending = await oauthRepo.consumePendingAuthorization({
          tenantId: scopedTenant,
          provider: 'tiktok',
          stateHash: hash
        });

        if (!pending) {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'oauth state expired, replayed, or invalid' } }, headers: { 'cache-control': 'no-store' } };
        }

        let codeVerifier;
        try {
          codeVerifier = decryptSecret(pending.codeVerifierCiphertext, {
            key,
            aad: pendingAad(scopedTenant, hash)
          });
        } catch {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'failed to decrypt authorization verifier' } }, headers: { 'cache-control': 'no-store' } };
        }

        // Exchange code for TikTok tokens
        let tokens;
        try {
          tokens = await exchangeTikTokCode({
            clientKey: cKey,
            clientSecret: cSecret,
            code: codeParam,
            redirectUri: redUri,
            codeVerifier,
            transport,
            clock
          });
        } catch (err) {
          return {
            status: 502,
            body: { error: { code: 'TIKTOK_EXCHANGE_FAILED', message: String(err?.message ?? 'TikTok token exchange failed') } },
            headers: { 'cache-control': 'no-store' }
          };
        }

        // Query TikTok creator identity
        let profile = {};
        try {
          profile = await fetchTikTokUserInfo({
            accessToken: tokens.accessToken,
            transport
          });
        } catch {
          // Profile fetch failure shouldn't fail link if open_id exists in tokens
        }

        const openId = tokens.openId || profile.openId;
        if (!openId) {
          return { status: 502, body: { error: { code: 'TIKTOK_OPEN_ID_MISSING', message: 'TikTok did not return a user openId' } }, headers: { 'cache-control': 'no-store' } };
        }

        // Encrypt tokens at rest
        const accessTokenCiphertext = tokenService.encryptToken(tokens.accessToken, {
          tenantId: scopedTenant,
          accountId: openId,
          kind: 'access'
        });
        const refreshTokenCiphertext = tokens.refreshToken ? tokenService.encryptToken(tokens.refreshToken, {
          tenantId: scopedTenant,
          accountId: openId,
          kind: 'refresh'
        }) : null;

        let linkedAccount;
        try {
          linkedAccount = await accountsRepo.upsertAccount(scopedTenant, {
            userId: pending.userId,
            openId,
            unionId: profile.unionId || null,
            username: profile.username || null,
            displayName: profile.displayName || null,
            avatarUrl: profile.avatarUrl || null,
            scope: tokens.scope || (Array.isArray(scopes) ? scopes.join(',') : String(scopes)),
            accessTokenCiphertext,
            refreshTokenCiphertext,
            tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
            refreshExpiresAt: tokens.refreshExpiresAt ? new Date(tokens.refreshExpiresAt).toISOString() : null,
            status: 'connected'
          });
        } catch (err) {
          if (err?.code === 'IDENTITY_ALREADY_LINKED') {
            return { status: 409, body: { error: { code: 'IDENTITY_ALREADY_LINKED', message: 'TikTok account is already linked to another workspace' } }, headers: { 'cache-control': 'no-store' } };
          }
          throw err;
        }

        return {
          status: 200,
          body: {
            linked: true,
            account: safeAccountView(linkedAccount)
          },
          headers: { 'cache-control': 'no-store' }
        };
      }

      // Accounts list: GET /api/v1/tiktok/accounts
      if (pathname === '/api/v1/tiktok/accounts' && method === 'GET') {
        const scopedTenant = tenantId(tenantHeader);
        const session = await authenticate(req, scopedTenant);
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };

        const statusFilter = url.searchParams.get('status') || null;
        const accounts = await accountsRepo.listAccounts(scopedTenant, { status: statusFilter });
        return {
          status: 200,
          body: { accounts: accounts.map(safeAccountView) },
          headers: { 'cache-control': 'no-store' }
        };
      }

      // Account specific routes: /api/v1/tiktok/accounts/:id[/action]
      const match = /^\/api\/v1\/tiktok\/accounts\/([0-9a-fA-F-]{36})(?:\/(disconnect|refresh))?$/.exec(pathname);
      if (match) {
        const accountId = match[1];
        const action = match[2] || null;
        const scopedTenant = tenantId(tenantHeader);
        const session = await authenticate(req, scopedTenant);
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };

        const role = String(session.user?.role ?? '').toLowerCase();

        if (!action && method === 'GET') {
          const account = await accountsRepo.getAccountById(scopedTenant, accountId);
          if (!account) return { status: 404, body: { error: { code: 'ACCOUNT_NOT_FOUND', message: 'TikTok account not found' } } };
          return { status: 200, body: { account: safeAccountView(account) }, headers: { 'cache-control': 'no-store' } };
        }

        if (action === 'disconnect' && method === 'POST') {
          if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'disconnecting accounts requires owner or admin role' } } };
          const result = await tokenService.disconnectAccount({
            tenantId: scopedTenant,
            accountId,
            actorId: session.user?.userId
          });
          return { status: 200, body: result, headers: { 'cache-control': 'no-store' } };
        }

        if (action === 'refresh' && method === 'POST') {
          if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'refreshing tokens requires owner or admin role' } } };
          try {
            const result = await tokenService.getValidAccessToken({
              tenantId: scopedTenant,
              accountId,
              refreshBufferMs: Infinity // force refresh
            });
            return {
              status: 200,
              body: {
                refreshed: result.refreshed,
                account: safeAccountView(result.account)
              },
              headers: { 'cache-control': 'no-store' }
            };
          } catch (err) {
            return {
              status: 502,
              body: { error: { code: err?.code || 'REFRESH_FAILED', message: String(err?.message ?? 'Failed to refresh token') } },
              headers: { 'cache-control': 'no-store' }
            };
          }
        }
      }

      // Enqueue TikTok publish job: POST /api/v1/tiktok/publish
      if (pathname === '/api/v1/tiktok/publish' && method === 'POST') {
        if (!publicationJobsRepo) {
          return { status: 503, body: { error: { code: 'PUBLISHING_UNAVAILABLE', message: 'Publication jobs repository is not configured' } } };
        }
        const scopedTenant = tenantId(tenantHeader);
        const session = await authenticate(req, scopedTenant);
        if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };

        const role = String(session.user?.role ?? '').toLowerCase();
        if (!WRITE_ROLES.has(role)) return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'publishing requires owner or admin role' } } };

        const body = await readJson(req);
        const videoUrl = String(body.videoUrl ?? '').trim();
        const title = String(body.title ?? '').trim();
        const idempotencyKey = String(body.idempotencyKey ?? '').trim() || `tt_${randomBytes(16).toString('hex')}`;

        if (!videoUrl || !title) {
          return { status: 400, body: { error: { code: 'INVALID_PUBLISH_INPUT', message: 'videoUrl and title are required' } } };
        }

        const result = await publicationJobsRepo.create(scopedTenant, {
          platform: 'tiktok',
          status: 'scheduled',
          idempotencyKey,
          contentItemId: body.contentItemId ?? null,
          scheduledFor: body.scheduledFor ?? null,
          providerResponse: {
            title,
            videoUrl,
            privacyLevel: body.privacyLevel || 'PUBLIC_TO_EVERYONE'
          }
        });

        return {
          status: result.created ? 201 : 200,
          body: { job: result.job, duplicate: result.duplicate },
          headers: { 'cache-control': 'no-store' }
        };
      }

      return { status: 404, body: { error: { code: 'TIKTOK_ROUTE_NOT_FOUND', message: 'TikTok route not found' } } };
    }
  });
}
