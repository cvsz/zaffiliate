function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeEmail(value) {
  const email = required(value, 'email').toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('email is invalid');
    error.code = 'INVALID_EMAIL';
    throw error;
  }
  return email;
}

function row(result) {
  return result?.rows?.[0] ?? null;
}

function affected(result) {
  return Number(result?.rowCount ?? 0);
}

export function createAuthRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('db with transaction(fn) is required');

  async function withTenant(tenantId, fn) {
    const id = required(tenantId, 'tenantId');
    return db.transaction(async (tx) => {
      await tx.query("SELECT set_config('app.tenant_id', $1, true)", [id]);
      return fn(tx, id);
    });
  }

  async function appendAudit(tx, { tenantId, actorId, action, resourceType, resourceId, outcome = 'allowed', reason = 'auth operation', payload = {} }) {
    await tx.query(
      `INSERT INTO audit_events
        (tenant_id, actor_id, action, resource_type, resource_id, outcome, reason, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [tenantId, String(actorId ?? 'anonymous'), action, resourceType, resourceId, outcome, reason, JSON.stringify(payload ?? {})]
    );
  }

  async function createTenantOwner({ tenantId, tenantSlug, tenantName, userId, email, passwordHash }) {
    const normalizedEmail = normalizeEmail(email);
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      await tx.query('INSERT INTO tenants (id, slug, name) VALUES ($1,$2,$3)', [scopedTenantId, required(tenantSlug, 'tenantSlug'), required(tenantName, 'tenantName')]);
      await tx.query(
        "INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES ($1,$2,'owner')",
        [scopedTenantId, required(userId, 'userId')]
      );
      const created = await tx.query(
        `INSERT INTO local_auth_users (tenant_id, user_id, email, password_hash)
         VALUES ($1,$2,$3,$4)
         RETURNING tenant_id AS "tenantId", user_id AS "userId", email, email_verified AS "emailVerified", created_at AS "createdAt"`,
        [scopedTenantId, userId, normalizedEmail, required(passwordHash, 'passwordHash')]
      );
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: userId,
        action: 'auth.user_registered',
        resourceType: 'user',
        resourceId: userId,
        reason: 'tenant owner registered'
      });
      return row(created);
    });
  }

  async function findCredentialsByEmail(tenantId, email) {
    const normalizedEmail = normalizeEmail(email);
    return withTenant(tenantId, async (tx, scopedTenantId) => row(await tx.query(
      `SELECT u.tenant_id AS "tenantId", u.user_id AS "userId", u.email,
              u.password_hash AS "passwordHash", u.email_verified AS "emailVerified",
              u.created_at AS "createdAt", m.role
       FROM local_auth_users u
       JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.user_id
       WHERE u.tenant_id = $1 AND u.email = $2`,
      [scopedTenantId, normalizedEmail]
    )));
  }

  async function findUserById(tenantId, userId) {
    return withTenant(tenantId, async (tx, scopedTenantId) => row(await tx.query(
      `SELECT u.tenant_id AS "tenantId", u.user_id AS "userId", u.email,
              u.email_verified AS "emailVerified", u.created_at AS "createdAt", m.role
       FROM local_auth_users u
       JOIN tenant_memberships m ON m.tenant_id = u.tenant_id AND m.user_id = u.user_id
       WHERE u.tenant_id = $1 AND u.user_id = $2`,
      [scopedTenantId, required(userId, 'userId')]
    )));
  }

  async function createSession({ tenantId, userId, tokenHash, expiresAt }) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const created = await tx.query(
        `INSERT INTO auth_sessions (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1,$2,$3,$4)
         RETURNING id, tenant_id AS "tenantId", user_id AS "userId", expires_at AS "expiresAt", created_at AS "createdAt"`,
        [scopedTenantId, required(userId, 'userId'), required(tokenHash, 'tokenHash'), expiresAt]
      );
      const session = row(created);
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: userId,
        action: 'auth.login',
        resourceType: 'session',
        resourceId: session.id,
        reason: 'local credential login'
      });
      return session;
    });
  }

  async function findSessionByHash(tenantId, tokenHash) {
    return withTenant(tenantId, async (tx, scopedTenantId) => row(await tx.query(
      `SELECT s.id, s.tenant_id AS "tenantId", s.user_id AS "userId",
              s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt",
              u.email, u.email_verified AS "emailVerified", m.role
       FROM auth_sessions s
       JOIN local_auth_users u ON u.tenant_id = s.tenant_id AND u.user_id = s.user_id
       JOIN tenant_memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
       WHERE s.tenant_id = $1 AND s.token_hash = $2`,
      [scopedTenantId, required(tokenHash, 'tokenHash')]
    )));
  }

  async function revokeSession(tenantId, tokenHash) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const result = await tx.query(
        `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now())
         WHERE tenant_id = $1 AND token_hash = $2
         RETURNING id, user_id AS "userId", revoked_at AS "revokedAt"`,
        [scopedTenantId, required(tokenHash, 'tokenHash')]
      );
      const session = row(result);
      if (session) await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: session.userId,
        action: 'auth.logout',
        resourceType: 'session',
        resourceId: session.id,
        reason: 'session revoked'
      });
      return session;
    });
  }

  async function auditLoginFailure(tenantId, userId) {
    return withTenant(tenantId, (tx, scopedTenantId) => appendAudit(tx, {
      tenantId: scopedTenantId,
      actorId: userId,
      action: 'auth.login_failed',
      resourceType: 'user',
      resourceId: userId,
      outcome: 'denied',
      reason: 'invalid credentials'
    }));
  }

  async function createRecoveryToken({ tenantId, userId, purpose, tokenHash, expiresAt, windowStart, maxRecent = 3 }) {
    if (!['email_verify', 'password_reset'].includes(purpose)) throw new Error('unsupported recovery purpose');
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const recent = await tx.query(
        `SELECT count(*)::int AS count
         FROM auth_recovery_tokens
         WHERE tenant_id=$1 AND user_id=$2 AND purpose=$3
           AND used_at IS NULL AND expires_at > now() AND created_at > $4`,
        [scopedTenantId, required(userId, 'userId'), purpose, windowStart]
      );
      if (Number(row(recent)?.count ?? 0) >= maxRecent) {
        const error = new Error('too many recovery requests');
        error.code = 'RECOVERY_RATE_LIMITED';
        throw error;
      }
      const created = await tx.query(
        `INSERT INTO auth_recovery_tokens (tenant_id, user_id, purpose, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, expires_at AS "expiresAt"`,
        [scopedTenantId, userId, purpose, required(tokenHash, 'tokenHash'), expiresAt]
      );
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: purpose === 'password_reset' ? 'anonymous' : userId,
        action: purpose === 'password_reset' ? 'auth.password_reset_requested' : 'auth.email_verify_requested',
        resourceType: 'user',
        resourceId: userId,
        reason: 'recovery token issued'
      });
      return row(created);
    });
  }

  async function confirmEmailVerification({ tenantId, tokenHash }) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const claimed = row(await tx.query(
        `UPDATE auth_recovery_tokens SET used_at = now()
         WHERE tenant_id=$1 AND token_hash=$2 AND purpose='email_verify'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id AS "userId"`,
        [scopedTenantId, required(tokenHash, 'tokenHash')]
      ));
      if (!claimed) return null;
      await tx.query(
        'UPDATE local_auth_users SET email_verified=true, updated_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [scopedTenantId, claimed.userId]
      );
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: claimed.userId,
        action: 'auth.email_verified',
        resourceType: 'user',
        resourceId: claimed.userId,
        reason: 'email verification completed'
      });
      return { userId: claimed.userId };
    });
  }

  async function resetPassword({ tenantId, tokenHash, passwordHash }) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const claimed = row(await tx.query(
        `UPDATE auth_recovery_tokens SET used_at = now()
         WHERE tenant_id=$1 AND token_hash=$2 AND purpose='password_reset'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id AS "userId"`,
        [scopedTenantId, required(tokenHash, 'tokenHash')]
      ));
      if (!claimed) return null;
      await tx.query(
        'UPDATE local_auth_users SET password_hash=$3, updated_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [scopedTenantId, claimed.userId, required(passwordHash, 'passwordHash')]
      );
      await tx.query(
        'UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at, now()) WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [scopedTenantId, claimed.userId]
      );
      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: claimed.userId,
        action: 'auth.password_reset_completed',
        resourceType: 'user',
        resourceId: claimed.userId,
        reason: 'password reset completed and sessions revoked'
      });
      return { userId: claimed.userId };
    });
  }

  return Object.freeze({
    createTenantOwner,
    findCredentialsByEmail,
    findUserById,
    createSession,
    findSessionByHash,
    revokeSession,
    auditLoginFailure,
    createRecoveryToken,
    confirmEmailVerification,
    resetPassword
  });
}
