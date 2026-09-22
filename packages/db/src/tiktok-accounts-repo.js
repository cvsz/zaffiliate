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

function first(result) {
  return result?.rows?.[0] ?? null;
}

function rowToAccount(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    openId: row.open_id,
    unionId: row.union_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    status: row.status,
    scope: row.scope,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at).toISOString() : null,
    refreshExpiresAt: row.refresh_expires_at ? new Date(row.refresh_expires_at).toISOString() : null,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null,
    lastSuccessfulApiCallAt: row.last_successful_api_call_at ? new Date(row.last_successful_api_call_at).toISOString() : null,
    lastError: row.last_error,
    tokenVersion: Number(row.token_version ?? 1),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  });
}

export function createTikTokAccountsRepo({ db } = {}) {
  if (!db || typeof db.transaction !== 'function' || typeof db.query !== 'function') {
    throw new TypeError('db with transaction and query is required');
  }

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
       VALUES ($1, $2, $3, 'tiktok_account', $4, $5, $6, $7::jsonb)`,
      [tenantId, String(actorId ?? 'system'), action, resourceId, outcome, reason, JSON.stringify(payload)]
    );
  }

  async function upsertAccount(tenantId, {
    userId,
    openId,
    unionId = null,
    username = null,
    displayName = null,
    avatarUrl = null,
    scope = null,
    accessTokenCiphertext,
    refreshTokenCiphertext = null,
    tokenExpiresAt = null,
    refreshExpiresAt = null,
    status = 'connected'
  } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const resolvedUserId = required(userId, 'userId');
      const resolvedOpenId = required(openId, 'openId');
      const resolvedAccessCiphertext = required(accessTokenCiphertext, 'accessTokenCiphertext');

      // Check if open_id is already bound to another tenant
      const existing = first(await tx.query(
        'SELECT id, tenant_id, user_id FROM tiktok_accounts WHERE open_id = $1',
        [resolvedOpenId]
      ));
      if (existing && (existing.tenant_id !== scopedTenantId || existing.user_id !== resolvedUserId)) {
        const error = new Error('TikTok account is already linked to another workspace or user');
        error.code = 'IDENTITY_ALREADY_LINKED';
        throw error;
      }

      const upserted = first(await tx.query(
        `INSERT INTO tiktok_accounts
          (tenant_id, user_id, open_id, union_id, username, display_name, avatar_url,
           status, scope, access_token_ciphertext, refresh_token_ciphertext,
           token_expires_at, refresh_expires_at, last_sync_at, last_successful_api_call_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), now())
         ON CONFLICT (tenant_id, user_id, open_id) DO UPDATE SET
           union_id = COALESCE(EXCLUDED.union_id, tiktok_accounts.union_id),
           username = COALESCE(EXCLUDED.username, tiktok_accounts.username),
           display_name = COALESCE(EXCLUDED.display_name, tiktok_accounts.display_name),
           avatar_url = COALESCE(EXCLUDED.avatar_url, tiktok_accounts.avatar_url),
           status = EXCLUDED.status,
           scope = COALESCE(EXCLUDED.scope, tiktok_accounts.scope),
           access_token_ciphertext = EXCLUDED.access_token_ciphertext,
           refresh_token_ciphertext = COALESCE(EXCLUDED.refresh_token_ciphertext, tiktok_accounts.refresh_token_ciphertext),
           token_expires_at = EXCLUDED.token_expires_at,
           refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, tiktok_accounts.refresh_expires_at),
           last_sync_at = now(),
           last_successful_api_call_at = now(),
           token_version = tiktok_accounts.token_version + 1,
           last_error = NULL,
           updated_at = now()
         RETURNING *`,
        [
          scopedTenantId,
          resolvedUserId,
          resolvedOpenId,
          unionId,
          username,
          displayName,
          avatarUrl,
          status,
          scope,
          resolvedAccessCiphertext,
          refreshTokenCiphertext,
          tokenExpiresAt,
          refreshExpiresAt
        ]
      ));

      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId: resolvedUserId,
        action: 'tiktok.account_linked',
        resourceId: upserted.id,
        reason: 'TikTok Developer account connected or reconnected',
        payload: { openId: resolvedOpenId, username }
      });

      return rowToAccount(upserted);
    });
  }

  async function getAccountById(tenantId, id) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const row = first(await tx.query(
        'SELECT * FROM tiktok_accounts WHERE tenant_id = $1 AND id = $2',
        [scopedTenantId, required(id, 'id')]
      ));
      return rowToAccount(row);
    });
  }

  async function getAccountByOpenId(tenantId, openId) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const row = first(await tx.query(
        'SELECT * FROM tiktok_accounts WHERE tenant_id = $1 AND open_id = $2',
        [scopedTenantId, required(openId, 'openId')]
      ));
      return rowToAccount(row);
    });
  }

  async function listAccounts(tenantId, { status = null, limit = 50 } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const capped = Math.max(1, Math.min(Number(limit) || 50, 100));
      let queryText = 'SELECT * FROM tiktok_accounts WHERE tenant_id = $1';
      const params = [scopedTenantId];
      if (status) {
        queryText += ' AND status = $2';
        params.push(String(status).trim());
      }
      queryText += ' ORDER BY created_at DESC LIMIT ' + (status ? '$3' : '$2');
      params.push(capped);
      const result = await tx.query(queryText, params);
      return (result.rows || []).map(rowToAccount);
    });
  }

  async function updateAccountStatus(tenantId, id, { status, lastError = null } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const row = first(await tx.query(
        `UPDATE tiktok_accounts SET
           status = $3,
           last_error = $4,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [scopedTenantId, required(id, 'id'), required(status, 'status'), lastError]
      ));
      return rowToAccount(row);
    });
  }

  async function disconnectAccount(tenantId, id, { actorId = 'system' } = {}) {
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const targetId = required(id, 'id');
      const row = first(await tx.query(
        `UPDATE tiktok_accounts SET
           status = 'disconnected',
           access_token_ciphertext = 'REVOKED',
           refresh_token_ciphertext = NULL,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [scopedTenantId, targetId]
      ));
      if (!row) return { disconnected: false, reason: 'not_found' };

      await appendAudit(tx, {
        tenantId: scopedTenantId,
        actorId,
        action: 'tiktok.account_disconnected',
        resourceId: targetId,
        reason: 'TikTok account disconnected by user or admin',
        payload: { openId: row.open_id }
      });
      return { disconnected: true, account: rowToAccount(row) };
    });
  }

  /**
   * Concurrency-safe token refresh using database row-level locking (SELECT ... FOR UPDATE).
   * Multiple concurrent workers detecting an expired token will wait on the row lock.
   * The first worker performs the refresh and updates token_expires_at.
   * Subsequent workers wake up, detect the refreshed timestamp, and skip calling the upstream API!
   */
  async function refreshTokenWithLock(tenantId, id, refreshFn) {
    if (typeof refreshFn !== 'function') throw new TypeError('refreshFn must be a function');
    return withTenant(tenantId, async (tx, scopedTenantId) => {
      const targetId = required(id, 'id');
      // Lock the row exclusively
      const row = first(await tx.query(
        'SELECT * FROM tiktok_accounts WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [scopedTenantId, targetId]
      ));
      if (!row) {
        const error = new Error('TikTok account not found');
        error.code = 'TIKTOK_ACCOUNT_NOT_FOUND';
        throw error;
      }

      const now = Date.now();
      const expiresAtMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
      // If token was refreshed while waiting for the lock (at least 60s of valid life remaining),
      // return existing row without calling upstream API.
      if (expiresAtMs > now + 60_000) {
        return Object.freeze({
          refreshed: false,
          reused: true,
          account: rowToAccount(row)
        });
      }

      try {
        const newTokens = await refreshFn(rowToAccount(row));
        const updated = first(await tx.query(
          `UPDATE tiktok_accounts SET
             access_token_ciphertext = $3,
             refresh_token_ciphertext = COALESCE($4, refresh_token_ciphertext),
             token_expires_at = $5,
             refresh_expires_at = COALESCE($6, refresh_expires_at),
             status = 'connected',
             token_version = token_version + 1,
             last_successful_api_call_at = now(),
             last_error = NULL,
             updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [
            scopedTenantId,
            targetId,
            required(newTokens.accessTokenCiphertext, 'accessTokenCiphertext'),
            newTokens.refreshTokenCiphertext ?? null,
            newTokens.tokenExpiresAt ?? null,
            newTokens.refreshExpiresAt ?? null
          ]
        ));

        await appendAudit(tx, {
          tenantId: scopedTenantId,
          actorId: row.user_id,
          action: 'tiktok.token_refreshed',
          resourceId: targetId,
          reason: 'concurrency-safe token refresh completed',
          payload: { openId: row.open_id, tokenVersion: updated.token_version }
        });

        return Object.freeze({
          refreshed: true,
          reused: false,
          account: rowToAccount(updated)
        });
      } catch (err) {
        const isReauthRequired = err?.code === 'REAUTH_REQUIRED' || err?.code === 'INVALID_GRANT';
        const newStatus = isReauthRequired ? 'reauth_required' : 'error';
        const failedRow = first(await tx.query(
          `UPDATE tiktok_accounts SET
             status = $3,
             last_error = $4,
             updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [scopedTenantId, targetId, newStatus, String(err?.message ?? 'token refresh failed')]
        ));

        await appendAudit(tx, {
          tenantId: scopedTenantId,
          actorId: row.user_id,
          action: 'tiktok.token_refresh_failed',
          resourceId: targetId,
          reason: String(err?.message ?? 'token refresh failed'),
          outcome: 'denied',
          payload: { openId: row.open_id, error: err?.code ?? 'REFRESH_ERROR' }
        });

        throw err;
      }
    });
  }

  return Object.freeze({
    upsertAccount,
    getAccountById,
    getAccountByOpenId,
    listAccounts,
    updateAccountStatus,
    disconnectAccount,
    refreshTokenWithLock
  });
}
