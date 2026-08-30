import { createHash } from 'node:crypto';

const DISABLED_OIDC_PASSWORD_HASH = `oidc-disabled$${'0'.repeat(64)}`;

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
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

function requireUuid(value, name) {
  const uuid = required(value, name).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    throw new Error(`${name} must be a UUID`);
  }
  return uuid;
}

function normalizeEmail(value) {
  const email = required(value, 'email').toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email is invalid');
  return email;
}

function first(result) {
  return result?.rows?.[0] ?? null;
}

export function oauthIdentityHash(issuer, subject) {
  return createHash('sha256')
    .update(required(issuer, 'issuer'))
    .update('\0')
    .update(required(subject, 'issuerSubject'))
    .digest('hex');
}

export function createOAuthLoginRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');

  async function setTenant(tx, tenantId) {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  }

  async function appendAudit(tx, { tenantId, actorId, action, resourceType, resourceId, reason, payload = {} }) {
    await tx.query(
      `INSERT INTO audit_events
        (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
       VALUES ($1,$2,$3,$4,$5,'allowed',$6,$7::jsonb)`,
      [tenantId, actorId, action, resourceType, resourceId, reason, JSON.stringify(payload)]
    );
  }

  async function createPendingLogin({ provider, issuer, stateHash, authorizationCiphertext, expiresAt } = {}) {
    const resolvedProvider = requireProvider(provider);
    const resolvedHash = requireStateHash(stateHash);
    return db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM oauth_login_authorizations
         WHERE provider=$1 AND (consumed_at IS NOT NULL OR expires_at <= now())`,
        [resolvedProvider]
      );
      return first(await tx.query(
        `INSERT INTO oauth_login_authorizations
          (provider, issuer, state_hash, authorization_ciphertext, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, provider, issuer, state_hash AS "stateHash",
                   expires_at AS "expiresAt", created_at AS "createdAt"`,
        [resolvedProvider, required(issuer, 'issuer'), resolvedHash, required(authorizationCiphertext, 'authorizationCiphertext'), expiresAt]
      ));
    });
  }

  async function consumePendingLogin({ provider, stateHash } = {}) {
    return db.transaction(async (tx) => first(await tx.query(
      `UPDATE oauth_login_authorizations
       SET consumed_at=now()
       WHERE provider=$1 AND state_hash=$2
         AND consumed_at IS NULL AND expires_at > now()
       RETURNING id, provider, issuer, state_hash AS "stateHash",
                 authorization_ciphertext AS "authorizationCiphertext",
                 expires_at AS "expiresAt", consumed_at AS "consumedAt"`,
      [requireProvider(provider), requireStateHash(stateHash)]
    )));
  }

  async function resolveIdentity({ issuer, issuerSubject } = {}) {
    const hash = oauthIdentityHash(issuer, issuerSubject);
    return db.transaction(async (tx) => first(await tx.query(
      `SELECT tenant_id AS "tenantId", user_id AS "userId"
       FROM oauth_identity_directory
       WHERE identity_hash=$1`,
      [hash]
    )));
  }

  async function issueExistingSession({ identity, tokenHash, expiresAt, provider, issuer }) {
    return db.transaction(async (tx) => {
      const tenantId = requireUuid(identity.tenantId, 'tenantId');
      const userId = required(identity.userId, 'userId');
      await setTenant(tx, tenantId);
      const user = first(await tx.query(
        `SELECT u.tenant_id AS "tenantId", u.user_id AS "userId", u.email,
                u.email_verified AS "emailVerified", u.created_at AS "createdAt", m.role
         FROM local_auth_users u
         JOIN tenant_memberships m ON m.tenant_id=u.tenant_id AND m.user_id=u.user_id
         WHERE u.tenant_id=$1 AND u.user_id=$2`,
        [tenantId, userId]
      ));
      if (!user) {
        const error = new Error('OIDC identity directory points to a missing user');
        error.code = 'OIDC_IDENTITY_DIRECTORY_BROKEN';
        throw error;
      }
      const session = first(await tx.query(
        `INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4)
         RETURNING id, expires_at AS "expiresAt"`,
        [tenantId, userId, required(tokenHash, 'tokenHash'), expiresAt]
      ));
      await appendAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'auth.login',
        resourceType: 'session',
        resourceId: session.id,
        reason: 'verified OIDC login',
        payload: { provider: requireProvider(provider), issuer: required(issuer, 'issuer') }
      });
      return { registered: false, user, session };
    });
  }

  async function completeOidcLogin({
    provider,
    issuer,
    issuerSubject,
    email,
    emailVerified = false,
    newTenantId,
    newTenantSlug,
    newTenantName = 'personal',
    newUserId,
    tokenHash,
    expiresAt
  } = {}) {
    const resolvedProvider = requireProvider(provider);
    const resolvedIssuer = required(issuer, 'issuer');
    const resolvedSubject = required(issuerSubject, 'issuerSubject');
    const resolvedEmail = normalizeEmail(email);
    const identityHash = oauthIdentityHash(resolvedIssuer, resolvedSubject);
    const existing = await resolveIdentity({ issuer: resolvedIssuer, issuerSubject: resolvedSubject });
    if (existing) {
      return issueExistingSession({ identity: existing, tokenHash, expiresAt, provider: resolvedProvider, issuer: resolvedIssuer });
    }

    const tenantId = requireUuid(newTenantId, 'newTenantId');
    const userId = required(newUserId, 'newUserId');
    try {
      return await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO tenants (id, slug, name) VALUES ($1,$2,$3)',
          [tenantId, required(newTenantSlug, 'newTenantSlug'), required(newTenantName, 'newTenantName')]
        );
        await setTenant(tx, tenantId);
        await tx.query(
          "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')",
          [tenantId, userId]
        );
        const user = first(await tx.query(
          `INSERT INTO local_auth_users
            (tenant_id, user_id, email, password_hash, email_verified)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING tenant_id AS "tenantId", user_id AS "userId", email,
                     email_verified AS "emailVerified", created_at AS "createdAt"`,
          [tenantId, userId, resolvedEmail, DISABLED_OIDC_PASSWORD_HASH, Boolean(emailVerified)]
        ));
        await tx.query(
          `INSERT INTO auth_user_identities (tenant_id, user_id, issuer, issuer_subject)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, userId, resolvedIssuer, resolvedSubject]
        );
        const directory = first(await tx.query(
          `SELECT tenant_id AS "tenantId", user_id AS "userId"
           FROM oauth_identity_directory WHERE identity_hash=$1`,
          [identityHash]
        ));
        if (!directory || directory.tenantId !== tenantId || directory.userId !== userId) {
          const error = new Error('OIDC identity directory synchronization failed');
          error.code = 'OIDC_IDENTITY_DIRECTORY_BROKEN';
          throw error;
        }
        const session = first(await tx.query(
          `INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at)
           VALUES ($1,$2,$3,$4)
           RETURNING id, expires_at AS "expiresAt"`,
          [tenantId, userId, required(tokenHash, 'tokenHash'), expiresAt]
        ));
        await appendAudit(tx, {
          tenantId,
          actorId: userId,
          action: 'auth.oidc_registered',
          resourceType: 'user',
          resourceId: userId,
          reason: 'new tenant owner registered from verified OIDC identity',
          payload: { provider: resolvedProvider, issuer: resolvedIssuer }
        });
        await appendAudit(tx, {
          tenantId,
          actorId: userId,
          action: 'auth.login',
          resourceType: 'session',
          resourceId: session.id,
          reason: 'verified OIDC login',
          payload: { provider: resolvedProvider, issuer: resolvedIssuer }
        });
        return { registered: true, user: { ...user, role: 'owner' }, session };
      });
    } catch (error) {
      if (error?.code !== '23505') throw error;
      const winner = await resolveIdentity({ issuer: resolvedIssuer, issuerSubject: resolvedSubject });
      if (!winner) throw error;
      return issueExistingSession({ identity: winner, tokenHash, expiresAt, provider: resolvedProvider, issuer: resolvedIssuer });
    }
  }

  return Object.freeze({ createPendingLogin, consumePendingLogin, resolveIdentity, completeOidcLogin });
}
