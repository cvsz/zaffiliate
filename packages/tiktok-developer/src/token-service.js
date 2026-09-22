import { encryptSecret, decryptSecret } from '../../security/src/secret-envelope.js';
import { refreshTikTokToken, revokeTikTokToken } from './auth.js';

function tokenAad(tenantId, accountId, kind) {
  return `zaffiliate:tiktok:token:${tenantId}:${accountId}:${kind}`;
}

export function createTikTokTokenService({
  repo,
  encryptionKey,
  clientKey,
  clientSecret,
  transport = fetch,
  clock = Date.now
} = {}) {
  if (!repo || typeof repo.refreshTokenWithLock !== 'function') {
    throw new TypeError('valid tiktok accounts repo is required');
  }
  const key = String(encryptionKey ?? '').trim();
  if (key.length < 32) {
    const err = new Error('ENCRYPTION_KEY must be at least 32 characters');
    err.code = 'ENCRYPTION_KEY_TOO_SHORT';
    throw err;
  }
  const cKey = String(clientKey ?? '').trim();
  const cSecret = String(clientSecret ?? '').trim();

  function encryptToken(token, { tenantId, accountId, kind }) {
    if (!token) return null;
    return encryptSecret(token, {
      key,
      aad: tokenAad(tenantId, accountId, kind)
    });
  }

  function decryptToken(ciphertext, { tenantId, accountId, kind }) {
    if (!ciphertext || ciphertext === 'REVOKED') return null;
    return decryptSecret(ciphertext, {
      key,
      aad: tokenAad(tenantId, accountId, kind)
    });
  }

  /**
   * Retrieves a valid, unexpired access token for a connected TikTok account.
   * If expired or expiring soon (within 5 minutes), triggers a concurrency-safe
   * row-locked refresh to prevent race conditions among multiple workers.
   */
  async function getValidAccessToken({ tenantId, accountId, refreshBufferMs = 300_000 }) {
    const account = await repo.getAccountById(tenantId, accountId);
    if (!account) {
      const err = new Error('TikTok account not found');
      err.code = 'TIKTOK_ACCOUNT_NOT_FOUND';
      throw err;
    }

    if (account.status !== 'connected') {
      const err = new Error(`TikTok account is in ${account.status} status and cannot be used`);
      err.code = `TIKTOK_ACCOUNT_${account.status.toUpperCase()}`;
      throw err;
    }

    const now = clock();
    const expiresAtMs = account.tokenExpiresAt ? new Date(account.tokenExpiresAt).getTime() : 0;
    const needsRefresh = expiresAtMs <= now + refreshBufferMs;

    if (!needsRefresh) {
      const decrypted = decryptToken(account.accessTokenCiphertext, {
        tenantId,
        accountId,
        kind: 'access'
      });
      return Object.freeze({ accessToken: decrypted, refreshed: false, account });
    }

    // Must refresh under concurrency-safe row lock
    const refreshResult = await repo.refreshTokenWithLock(tenantId, accountId, async (lockedAccount) => {
      if (!cKey || !cSecret) {
        const err = new Error('TikTok client credentials not configured for refresh');
        err.code = 'TIKTOK_CONFIG_MISSING';
        throw err;
      }
      const rawRefreshToken = decryptToken(lockedAccount.refreshTokenCiphertext, {
        tenantId,
        accountId,
        kind: 'refresh'
      });
      if (!rawRefreshToken) {
        const err = new Error('no refresh token available for account');
        err.code = 'REAUTH_REQUIRED';
        throw err;
      }

      const fresh = await refreshTikTokToken({
        clientKey: cKey,
        clientSecret: cSecret,
        refreshToken: rawRefreshToken,
        transport,
        clock
      });

      return {
        accessTokenCiphertext: encryptToken(fresh.accessToken, { tenantId, accountId, kind: 'access' }),
        refreshTokenCiphertext: fresh.refreshToken
          ? encryptToken(fresh.refreshToken, { tenantId, accountId, kind: 'refresh' })
          : lockedAccount.refreshTokenCiphertext,
        tokenExpiresAt: fresh.expiresAt ? new Date(fresh.expiresAt).toISOString() : null,
        refreshExpiresAt: fresh.refreshExpiresAt ? new Date(fresh.refreshExpiresAt).toISOString() : null
      };
    });

    const activeAccount = refreshResult.account;
    const decrypted = decryptToken(activeAccount.accessTokenCiphertext, {
      tenantId,
      accountId,
      kind: 'access'
    });

    return Object.freeze({
      accessToken: decrypted,
      refreshed: refreshResult.refreshed,
      account: activeAccount
    });
  }

  async function disconnectAccount({ tenantId, accountId, actorId = 'system' }) {
    const account = await repo.getAccountById(tenantId, accountId);
    if (!account) return { disconnected: false, reason: 'not_found' };

    // Attempt token revocation if token is available
    if (cKey && cSecret && account.accessTokenCiphertext && account.accessTokenCiphertext !== 'REVOKED') {
      try {
        const rawAccessToken = decryptToken(account.accessTokenCiphertext, {
          tenantId,
          accountId,
          kind: 'access'
        });
        if (rawAccessToken) {
          await revokeTikTokToken({
            clientKey: cKey,
            clientSecret: cSecret,
            token: rawAccessToken,
            transport
          });
        }
      } catch {
        // Revocation failure is best-effort
      }
    }

    return repo.disconnectAccount(tenantId, accountId, { actorId });
  }

  return Object.freeze({
    encryptToken,
    decryptToken,
    getValidAccessToken,
    disconnectAccount
  });
}
