import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../../packages/security/src/secret-envelope.js';
import { SESSION_TTL_MS } from './auth-service.js';

const OAUTH_PREFIX = '/api/v1/oauth/';
const LOGIN_STATE_PREFIX = 'login.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function bearerToken(headers = {}) {
  const value = String(headers.authorization ?? '');
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : '';
}

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

function stateHash(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function parseBoundState(value) {
  const state = String(value ?? '');
  if (!state || state.length > 512) return null;
  const dot = state.indexOf('.');
  if (dot !== 36) return null;
  const boundTenant = state.slice(0, dot).toLowerCase();
  const randomState = state.slice(dot + 1);
  if (!UUID_PATTERN.test(boundTenant) || !/^[A-Za-z0-9_-]{16,256}$/.test(randomState)) return null;
  return { tenantId: boundTenant, state };
}

function parseLoginState(value) {
  const state = String(value ?? '');
  if (!state.startsWith(LOGIN_STATE_PREFIX) || state.length > 512) return null;
  const randomState = state.slice(LOGIN_STATE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(randomState)) return null;
  return { state };
}

function pendingAad(tenant, provider, hash) {
  return `zaffiliate:oauth:pending:${tenant}:${provider}:${hash}`;
}

function loginPendingAad(provider, hash) {
  return `zaffiliate:oauth:login:${provider}:${hash}`;
}

function tokenAad(tenant, userId, provider, kind) {
  return `zaffiliate:oauth:token:${tenant}:${userId}:${provider}:${kind}`;
}

function pendingSecretPayload(authorization) {
  return JSON.stringify({
    version: 1,
    codeVerifier: String(authorization.codeVerifier ?? ''),
    nonce: authorization.nonce == null ? null : String(authorization.nonce)
  });
}

function decodePendingSecret(value) {
  const plaintext = String(value ?? '');
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed?.version === 1 && typeof parsed.codeVerifier === 'string' && parsed.codeVerifier) {
      const nonce = typeof parsed.nonce === 'string' && parsed.nonce ? parsed.nonce : null;
      return { codeVerifier: parsed.codeVerifier, nonce };
    }
  } catch {
    // Backward compatibility for pending generic-OAuth rows created before the
    // encrypted payload was versioned to carry an OIDC nonce.
  }
  return plaintext ? { codeVerifier: plaintext, nonce: null } : null;
}

function syntheticIdentityEmail(issuer, subject) {
  const tag = createHash('sha256').update(`${issuer}\0${subject}`, 'utf8').digest('hex').slice(0, 24);
  return `oidc-${tag}@oidc.invalid`;
}

function loginToken() {
  return `zs_${randomBytes(32).toString('base64url')}`;
}

function personalTenantSlug(provider) {
  return `oidc-${provider}-${randomBytes(6).toString('hex')}`;
}

async function limited(rateLimiter, key) {
  const verdict = await rateLimiter.tryAcquire(key);
  if (verdict.allowed) return null;
  return {
    status: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'too many requests' } },
    headers: { 'retry-after': String(Math.ceil(verdict.retryAfterMs / 1000) || 1), 'cache-control': 'no-store' }
  };
}

function failure(error) {
  return {
    status: Number(error?.status ?? 500),
    body: {
      error: {
        code: String(error?.code ?? 'OAUTH_INTERNAL'),
        message: Number(error?.status ?? 500) >= 500 ? 'unexpected oauth failure' : String(error?.message ?? 'oauth request failed')
      }
    },
    headers: { 'cache-control': 'no-store' }
  };
}

export function createProductionOAuthApi({
  registry,
  repo,
  loginRepo = null,
  localAuthService,
  encryptionKey,
  rateLimiter,
  clock = Date.now
} = {}) {
  if (!(registry instanceof Map)) throw new TypeError('oauth registry must be a Map');
  if (!repo || typeof repo.createPendingAuthorization !== 'function') throw new TypeError('oauth repo is required');
  if (loginRepo !== null && (
    typeof loginRepo.createPendingLogin !== 'function' ||
    typeof loginRepo.consumePendingLogin !== 'function' ||
    typeof loginRepo.completeOidcLogin !== 'function'
  )) throw new TypeError('oauth login repo is invalid');
  if (!localAuthService || typeof localAuthService.getSession !== 'function') throw new TypeError('local auth service is required');
  if (!rateLimiter || typeof rateLimiter.tryAcquire !== 'function') throw new TypeError('rateLimiter is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (registry.size > 0 && String(encryptionKey ?? '').length < 32) {
    const error = new Error('ENCRYPTION_KEY must be at least 32 characters when OAuth is configured');
    error.code = 'OAUTH_ENCRYPTION_KEY_REQUIRED';
    throw error;
  }

  async function authenticate(req, scopedTenant) {
    const token = bearerToken(req.headers);
    if (!token) return null;
    return localAuthService.getSession({ tenantId: scopedTenant, token });
  }

  async function handleLoginStart({ req, entry, provider, issuer, ip }) {
    if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
      return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
    }
    if (!loginRepo || typeof entry.verifyIdentityClaims !== 'function') {
      return { status: 503, body: { error: { code: 'OIDC_LOGIN_NOT_CONFIGURED', message: 'verified OIDC login is not configured' } }, headers: { 'cache-control': 'no-store' } };
    }
    const throttled = await limited(rateLimiter, `oauth:login:${provider}:${ip}`);
    if (throttled) return throttled;
    const authorization = entry.flow.createAuthorization();
    if (!authorization.nonce) {
      return { status: 500, body: { error: { code: 'OAUTH_MISCONFIGURED', message: 'OIDC login requires a nonce-enabled flow' } }, headers: { 'cache-control': 'no-store' } };
    }
    const state = `${LOGIN_STATE_PREFIX}${authorization.state}`;
    const hash = stateHash(state);
    const authorizationCiphertext = encryptSecret(pendingSecretPayload(authorization), {
      key: encryptionKey,
      aad: loginPendingAad(provider, hash)
    });
    await loginRepo.createPendingLogin({
      provider,
      issuer,
      stateHash: hash,
      authorizationCiphertext,
      expiresAt: new Date(authorization.expiresAt)
    });
    const authorizeUrl = new URL(authorization.url);
    authorizeUrl.searchParams.set('state', state);
    return {
      status: 302,
      body: { authorizeUrl: authorizeUrl.toString(), expiresAt: authorization.expiresAt },
      headers: { location: authorizeUrl.toString(), 'cache-control': 'no-store' }
    };
  }

  async function handleLoginCallback({ entry, provider, issuer, state, code, ip }) {
    if (!loginRepo || typeof entry.verifyIdentityClaims !== 'function') {
      return { status: 503, body: { error: { code: 'OIDC_LOGIN_NOT_CONFIGURED', message: 'verified OIDC login is not configured' } }, headers: { 'cache-control': 'no-store' } };
    }
    const parsed = parseLoginState(state);
    if (!parsed || !code || code.length > 4096) {
      return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
    }
    const throttled = await limited(rateLimiter, `oauth:login-callback:${provider}:${ip}`);
    if (throttled) return throttled;
    const hash = stateHash(parsed.state);
    const pending = await loginRepo.consumePendingLogin({ provider, stateHash: hash });
    if (!pending || pending.provider !== provider || String(pending.issuer) !== issuer) {
      return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
    }

    let pendingSecret;
    try {
      pendingSecret = decodePendingSecret(decryptSecret(pending.authorizationCiphertext, {
        key: encryptionKey,
        aad: loginPendingAad(provider, hash)
      }));
      if (!pendingSecret?.codeVerifier || !pendingSecret?.nonce) throw new Error('missing OIDC pending secret');
    } catch {
      return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
    }

    let tokens;
    try {
      tokens = await entry.flow.exchangeCode({
        authorization: {
          state: parsed.state,
          codeVerifier: pendingSecret.codeVerifier,
          expiresAt: new Date(pending.expiresAt).getTime()
        },
        code
      });
    } catch {
      return { status: 502, body: { error: { code: 'OAUTH_EXCHANGE_FAILED', message: 'oauth provider token exchange failed' } }, headers: { 'cache-control': 'no-store' } };
    }

    let identity;
    try {
      identity = await entry.verifyIdentityClaims({ tokens, nonce: pendingSecret.nonce });
    } catch {
      return { status: 401, body: { error: { code: 'OIDC_ID_TOKEN_INVALID', message: 'OIDC identity token verification failed' } }, headers: { 'cache-control': 'no-store' } };
    }
    const issuerSubject = String(identity?.subject ?? '').trim();
    if (!issuerSubject || issuerSubject.length > 1024) {
      return { status: 401, body: { error: { code: 'OIDC_ID_TOKEN_INVALID', message: 'OIDC identity token verification failed' } }, headers: { 'cache-control': 'no-store' } };
    }
    const email = identity.email ?? syntheticIdentityEmail(issuer, issuerSubject);
    const rawToken = loginToken();
    const expiresAt = new Date(clock() + SESSION_TTL_MS);
    const result = await loginRepo.completeOidcLogin({
      provider,
      issuer,
      issuerSubject,
      email,
      emailVerified: Boolean(identity.email && identity.emailVerified),
      newTenantId: randomUUID(),
      newTenantSlug: personalTenantSlug(provider),
      newTenantName: 'personal',
      newUserId: `usr_${randomUUID()}`,
      tokenHash: stateHash(rawToken),
      expiresAt
    });
    return {
      status: 200,
      body: {
        token: rawToken,
        expiresAt: expiresAt.toISOString(),
        registered: Boolean(result.registered),
        user: result.user
      },
      headers: { 'cache-control': 'no-store' }
    };
  }

  return Object.freeze({
    async handle({ req, pathname, tenantHeader = '' } = {}) {
      if (!String(pathname ?? '').startsWith(OAUTH_PREFIX)) return null;
      const match = /^\/api\/v1\/oauth\/([a-z0-9_-]{2,32})\/(authorize|login|callback|disconnect)$/.exec(String(pathname));
      if (!match) return { status: 404, body: { error: { code: 'OAUTH_ROUTE_NOT_FOUND', message: 'oauth route not found' } } };
      const provider = match[1];
      const action = match[2];
      const entry = registry.get(provider);
      if (!entry) return { status: 503, body: { error: { code: 'OAUTH_NOT_CONFIGURED', message: 'oauth provider is not configured' } } };
      if (!entry.flow || typeof entry.flow.createAuthorization !== 'function' || typeof entry.flow.exchangeCode !== 'function') {
        return { status: 500, body: { error: { code: 'OAUTH_MISCONFIGURED', message: 'oauth provider flow is invalid' } } };
      }
      const issuer = String(entry.issuer ?? '').trim();
      if (!issuer) return { status: 500, body: { error: { code: 'OAUTH_MISCONFIGURED', message: 'oauth issuer is missing' } } };
      const ip = String(req?.socket?.remoteAddress ?? 'unknown');
      const url = new URL(req.url || '/', 'http://localhost');

      try {
        if (action === 'login') return await handleLoginStart({ req, entry, provider, issuer, ip });

        if (action === 'authorize') {
          if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
          const scopedTenant = tenantId(tenantHeader);
          const session = await authenticate(req, scopedTenant);
          if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };
          const throttled = await limited(rateLimiter, `oauth:authorize:${scopedTenant}:${session.user.userId}:${provider}:${ip}`);
          if (throttled) return throttled;

          const authorization = entry.flow.createAuthorization();
          const boundState = `${scopedTenant}.${authorization.state}`;
          const hash = stateHash(boundState);
          const verifierCiphertext = encryptSecret(pendingSecretPayload(authorization), {
            key: encryptionKey,
            aad: pendingAad(scopedTenant, provider, hash)
          });
          await repo.createPendingAuthorization({
            tenantId: scopedTenant,
            userId: session.user.userId,
            provider,
            issuer,
            stateHash: hash,
            codeVerifierCiphertext: verifierCiphertext,
            expiresAt: new Date(authorization.expiresAt)
          });
          const authorizeUrl = new URL(authorization.url);
          authorizeUrl.searchParams.set('state', boundState);
          return {
            status: 302,
            body: { authorizeUrl: authorizeUrl.toString(), expiresAt: authorization.expiresAt },
            headers: { location: authorizeUrl.toString(), 'cache-control': 'no-store' }
          };
        }

        if (action === 'disconnect') {
          if (String(req.method ?? '').toUpperCase() !== 'POST') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
          const scopedTenant = tenantId(tenantHeader);
          const session = await authenticate(req, scopedTenant);
          if (!session) return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'authentication required' } }, headers: { 'cache-control': 'no-store' } };
          const throttled = await limited(rateLimiter, `oauth:disconnect:${scopedTenant}:${session.user.userId}:${provider}:${ip}`);
          if (throttled) return throttled;
          const removed = await repo.disconnectProvider({
            tenantId: scopedTenant,
            userId: session.user.userId,
            provider,
            issuer
          });
          return {
            status: 200,
            body: {
              disconnected: true,
              provider,
              removedLinks: removed.removedIdentities,
              dataDeleted: ['stored_tokens', 'account_link']
            },
            headers: { 'cache-control': 'no-store' }
          };
        }

        if (String(req.method ?? 'GET').toUpperCase() !== 'GET') return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } } };
        const state = String(url.searchParams.get('state') ?? '');
        const code = String(url.searchParams.get('code') ?? '');
        if (parseLoginState(state)) {
          return await handleLoginCallback({ entry, provider, issuer, state, code, ip });
        }
        const bound = parseBoundState(state);
        if (!bound || !code || code.length > 4096) {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
        }
        const throttled = await limited(rateLimiter, `oauth:callback:${bound.tenantId}:${provider}:${ip}`);
        if (throttled) return throttled;
        const hash = stateHash(bound.state);
        const pending = await repo.consumePendingAuthorization({ tenantId: bound.tenantId, provider, stateHash: hash });
        if (!pending || pending.provider !== provider) {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
        }

        let pendingSecret;
        try {
          pendingSecret = decodePendingSecret(decryptSecret(pending.codeVerifierCiphertext, {
            key: encryptionKey,
            aad: pendingAad(bound.tenantId, provider, hash)
          }));
          if (!pendingSecret) throw new Error('missing pending secret');
        } catch {
          return { status: 400, body: { error: { code: 'INVALID_OAUTH_STATE', message: 'unknown, expired or already-used oauth state' } }, headers: { 'cache-control': 'no-store' } };
        }

        let tokens;
        try {
          tokens = await entry.flow.exchangeCode({
            authorization: { state: bound.state, codeVerifier: pendingSecret.codeVerifier, expiresAt: new Date(pending.expiresAt).getTime() },
            code
          });
        } catch {
          return { status: 502, body: { error: { code: 'OAUTH_EXCHANGE_FAILED', message: 'oauth provider token exchange failed' } }, headers: { 'cache-control': 'no-store' } };
        }

        let issuerSubject = null;
        try {
          if (typeof entry.verifyIdentity === 'function') {
            issuerSubject = await entry.verifyIdentity({ tokens, nonce: pendingSecret.nonce });
          } else if (typeof entry.resolveSubject === 'function') {
            issuerSubject = await entry.resolveSubject(tokens);
          } else {
            issuerSubject = tokens.providerAccountId;
          }
        } catch {
          return { status: 502, body: { error: { code: 'OAUTH_IDENTITY_VERIFICATION_FAILED', message: 'oauth provider identity verification failed' } }, headers: { 'cache-control': 'no-store' } };
        }
        issuerSubject = String(issuerSubject ?? '').trim();
        if (!issuerSubject || issuerSubject.length > 1024) {
          return { status: 502, body: { error: { code: 'OAUTH_SUBJECT_MISSING', message: 'provider did not return a usable account subject' } }, headers: { 'cache-control': 'no-store' } };
        }

        const accessTokenCiphertext = encryptSecret(tokens.accessToken, {
          key: encryptionKey,
          aad: tokenAad(bound.tenantId, pending.userId, provider, 'access')
        });
        const refreshTokenCiphertext = tokens.refreshToken ? encryptSecret(tokens.refreshToken, {
          key: encryptionKey,
          aad: tokenAad(bound.tenantId, pending.userId, provider, 'refresh')
        }) : null;

        try {
          await repo.completeOAuthLink({
            tenantId: bound.tenantId,
            userId: pending.userId,
            provider,
            issuer,
            issuerSubject,
            accessTokenCiphertext,
            refreshTokenCiphertext,
            tokenType: tokens.tokenType,
            scope: tokens.scope,
            expiresAt: Number.isFinite(tokens.expiresAt) ? new Date(tokens.expiresAt) : null
          });
        } catch (error) {
          if (error?.code === 'IDENTITY_ALREADY_LINKED') {
            return { status: 409, body: { error: { code: 'IDENTITY_ALREADY_LINKED', message: 'external identity is already bound to another user' } }, headers: { 'cache-control': 'no-store' } };
          }
          if (error?.code === 'OAUTH_USER_NOT_FOUND') {
            return { status: 409, body: { error: { code: 'OAUTH_USER_NOT_FOUND', message: 'oauth user no longer exists' } }, headers: { 'cache-control': 'no-store' } };
          }
          throw error;
        }
        return {
          status: 200,
          body: { linked: true, provider, expiresAt: tokens.expiresAt },
          headers: { 'cache-control': 'no-store' }
        };
      } catch (error) {
        return failure(error);
      }
    }
  });
}
