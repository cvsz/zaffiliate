function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireTenantId(value) {
  const tenantId = required(value, 'tenantId').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(tenantId)) {
    const error = new Error('tenantId must be a UUID');
    error.code = 'INVALID_TENANT_ID';
    throw error;
  }
  return tenantId;
}

function requireProvider(value) {
  const provider = required(value, 'provider').toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(provider)) throw new Error('provider must be 2-32 chars of a-z0-9_-');
  return provider;
}

function requireStateHash(value) {
  const hash = required(value, 'stateHash').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('stateHash must be lowercase sha256 hex');
  return hash;
}

function first(result) {
  return result?.rows?.[0] ?? null;
}

export function createOAuthRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');

  async function withTenant(tenantId, fn) {
    const id = requireTenantId(tenantId);
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
      return fn(tx, id);
    });
  }

  async function appendAudit(tx, { tenantId, actorId, action, resourceId, reason, outcome = 'allowed', payload = {} }) {
    await tx.query(
      `INSERT INTO audit_events
        (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
       VALUES ($1,$2,$3,'oauth_identity',$4,$5,$6,$7::jsonb)`,
      [tenantId, String(actorId ?? 'system'), action, resourceId, outcome, reason, JSON.stringify(payload)]
    );
  }

  async function createPendingAuthorization({
    tenantId,
    userId,
    provider,
    issuer,
    stateHash,
    codeVerifierCiphertext,
    expiresAt
  } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const resolvedUserId = required(userId, 'userId');
      const resolvedProvider = requireProvider(provider);
      await tx.query(
        `DELETE FROM oauth_pending_authorizations
         WHERE tenant_id=$1 AND user_id=$2 AND provider=$3
           AND (consumed_at IS NOT NULL OR expires_at <= now())`,
        [scopedTenantId, resolvedUserId, resolvedProvider]
      );
      const created = first(await tx.query(
        `INSERT INTO oauth_pending_authorizations
          (tenant_id, user_id, provider, issuer, state_hash, code_verifier_ciphertext, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, tenant_id AS "tenantId", user_id AS "userId", provider, issuer,
                   state_hash AS "stateHash", expires_at AS "expiresAt", created_at AS "createdAt"`,
        [
          scopedTenantId,
          resolvedUserId,
          resolvedProvider,
          required(issuer, 'issuer'),
          requireStateHash(stateHash),
          required(codeVerifierCiphertext, 'codeVerifierCiphertext'),
          expiresAt
        ]
      ));
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: resolvedUserId,
        action: 'oauth.authorization_started',
        resourceId: created.id,
        reason: 'oauth authorization state persisted',
        payload: { provider: resolvedProvider }
      });
      return created;
    });
  }

  async function consumePendingAuthorization({ tenantId, provider, stateHash } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => first(await tx.query(
      `UPDATE oauth_pending_authorizations
       SET consumed_at=now()
       WHERE tenant_id=$1 AND provider=$2 AND state_hash=$3
         AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, tenant_id AS "tenantId", user_id AS "userId", provider, issuer,
                 state_hash AS "stateHash", code_verifier_ciphertext AS "codeVerifierCiphertext",
                 expires_at AS "expiresAt", consumed_at AS "consumedAt"`,
      [scopedTenantId, requireProvider(provider), requireStateHash(stateHash)]
    )));
  }

  async function completeOAuthLink({
    tenantId,
    userId,
    provider,
    issuer,
    issuerSubject,
    accessTokenCiphertext,
    refreshTokenCiphertext = null,
    tokenType = null,
    scope = null,
    expiresAt = null
  } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const resolvedUserId = required(userId, 'userId');
      const resolvedProvider = requireProvider(provider);
      const resolvedIssuer = required(issuer, 'issuer');
      const resolvedSubject = required(issuerSubject, 'issuerSubject');

      const user = first(await tx.query(
        'SELECT user_id AS "userId" FROM local_auth_users WHERE tenant_id=$1 AND user_id=$2',
        [scopedTenantId, resolvedUserId]
      ));
      if (!user) {
        const error = new Error('local auth user not found');
        error.code = 'OAUTH_USER_NOT_FOUND';
        throw error;
      }

      await tx.query(
        `INSERT INTO auth_user_identities (tenant_id, user_id, issuer, issuer_subject)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (issuer, issuer_subject) DO NOTHING`,
        [scopedTenantId, resolvedUserId, resolvedIssuer, resolvedSubject]
      );

      const identity = first(await tx.query(
        `SELECT id, user_id AS "userId", issuer, issuer_subject AS "issuerSubject"
         FROM auth_user_identities
         WHERE tenant_id=$1 AND issuer=$2 AND issuer_subject=$3`,
        [scopedTenantId, resolvedIssuer, resolvedSubject]
      ));
      if (!identity || identity.userId !== resolvedUserId) {
        const error = new Error('external identity is already linked to another user');
        error.code = 'IDENTITY_ALREADY_LINKED';
        throw error;
      }

      await tx.query(
        `INSERT INTO oauth_provider_tokens
          (tenant_id, user_id, provider, issuer, access_token_ciphertext, refresh_token_ciphertext, token_type, scope, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, user_id, provider) DO UPDATE SET
           issuer=EXCLUDED.issuer,
           access_token_ciphertext=EXCLUDED.access_token_ciphertext,
           refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
           token_type=EXCLUDED.token_type,
           scope=EXCLUDED.scope,
           expires_at=EXCLUDED.expires_at,
           updated_at=now()`,
        [
          scopedTenantId,
          resolvedUserId,
          resolvedProvider,
          resolvedIssuer,
          required(accessTokenCiphertext, 'accessTokenCiphertext'),
          refreshTokenCiphertext == null ? null : required(refreshTokenCiphertext, 'refreshTokenCiphertext'),
          tokenType == null ? null : String(tokenType),
          scope == null ? null : String(scope),
          expiresAt
        ]
      );

      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: resolvedUserId,
        action: 'oauth.identity_linked',
        resourceId: identity.id,
        reason: 'external identity linked and provider tokens persisted',
        payload: { provider: resolvedProvider, issuer: resolvedIssuer }
      });
      return { linked: true, identityId: identity.id, userId: resolvedUserId };
    });
  }

  async function readProviderTokens({ tenantId, userId, provider } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => first(await tx.query(
      `SELECT tenant_id AS "tenantId", user_id AS "userId", provider, issuer,
              access_token_ciphertext AS "accessTokenCiphertext",
              refresh_token_ciphertext AS "refreshTokenCiphertext",
              token_type AS "tokenType", scope, expires_at AS "expiresAt", updated_at AS "updatedAt"
       FROM oauth_provider_tokens
       WHERE tenant_id=$1 AND user_id=$2 AND provider=$3`,
      [scopedTenantId, required(userId, 'userId'), requireProvider(provider)]
    )));
  }

  async function disconnectProvider({ tenantId, userId, provider, issuer } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const resolvedUserId = required(userId, 'userId');
      const resolvedProvider = requireProvider(provider);
      const resolvedIssuer = required(issuer, 'issuer');
      const tokenDelete = await tx.query(
        'DELETE FROM oauth_provider_tokens WHERE tenant_id=$1 AND user_id=$2 AND provider=$3',
        [scopedTenantId, resolvedUserId, resolvedProvider]
      );
      const identityDelete = await tx.query(
        'DELETE FROM auth_user_identities WHERE tenant_id=$1 AND user_id=$2 AND issuer=$3',
        [scopedTenantId, resolvedUserId, resolvedIssuer]
      );
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: resolvedUserId,
        action: 'oauth.identity_unlinked',
        resourceId: resolvedUserId,
        reason: 'external identity and provider tokens removed',
        payload: { provider: resolvedProvider, issuer: resolvedIssuer }
      });
      return {
        removedIdentities: Number(identityDelete?.rowCount ?? 0),
        removedTokenSets: Number(tokenDelete?.rowCount ?? 0)
      };
    });
  }

  return Object.freeze({
    createPendingAuthorization,
    consumePendingAuthorization,
    completeOAuthLink,
    readProviderTokens,
    disconnectProvider
  });
}
