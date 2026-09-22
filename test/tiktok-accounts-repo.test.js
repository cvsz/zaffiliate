import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAccountsRepo } from '../packages/db/src/tiktok-accounts-repo.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date().toISOString();

function createFakeDb(handlers = []) {
  const queries = [];
  const fakeDb = {
    queries,
    async query(text, params) {
      queries.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
      for (const h of handlers) {
        const res = h(text, params);
        if (res !== undefined) return res;
      }
      return { rows: [] };
    },
    async transaction(fn) {
      return fn(fakeDb);
    }
  };
  return fakeDb;
}

function sampleAccountRow(overrides = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenant_id: TENANT_A,
    user_id: 'usr_123',
    open_id: 'tt_open_123',
    union_id: 'tt_union_123',
    username: 'test_creator',
    display_name: 'Test Creator',
    avatar_url: 'https://p16-sign.tiktokcdn.com/avatar.jpg',
    status: 'connected',
    scope: 'user.info.basic,video.publish,video.upload',
    access_token_ciphertext: 'enc_access_token',
    refresh_token_ciphertext: 'enc_refresh_token',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400_000).toISOString(),
    last_sync_at: NOW,
    last_successful_api_call_at: NOW,
    last_error: null,
    token_version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides
  };
}

test('upsertAccount connects a new account and sets tenant context', async () => {
  const db = createFakeDb([
    (text) => {
      if (/SELECT id, tenant_id, user_id FROM tiktok_accounts WHERE open_id/i.test(text)) {
        return { rows: [] };
      }
      if (/INSERT INTO tiktok_accounts/i.test(text)) {
        return { rows: [sampleAccountRow()] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  const account = await repo.upsertAccount(TENANT_A, {
    userId: 'usr_123',
    openId: 'tt_open_123',
    username: 'test_creator',
    displayName: 'Test Creator',
    accessTokenCiphertext: 'enc_access_token',
    refreshTokenCiphertext: 'enc_refresh_token'
  });

  assert.equal(account.openId, 'tt_open_123');
  assert.equal(account.status, 'connected');
  assert.equal(account.tokenVersion, 1);
  assert.ok(db.queries.some((q) => q.text.includes("set_config('app.tenant_id'")));
  assert.ok(db.queries.some((q) => q.text.includes('INSERT INTO audit_events')));
});

test('upsertAccount rejects account if open_id is linked to another tenant', async () => {
  const db = createFakeDb([
    (text) => {
      if (/SELECT id, tenant_id, user_id FROM tiktok_accounts WHERE open_id/i.test(text)) {
        return { rows: [{ id: 'other_id', tenant_id: TENANT_B, user_id: 'usr_other' }] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  await assert.rejects(
    async () => repo.upsertAccount(TENANT_A, {
      userId: 'usr_123',
      openId: 'tt_open_123',
      accessTokenCiphertext: 'enc_token'
    }),
    (err) => err.code === 'IDENTITY_ALREADY_LINKED'
  );
});

test('getAccountById and getAccountByOpenId enforce tenant isolation', async () => {
  const db = createFakeDb([
    (text, params) => {
      if (/WHERE tenant_id = \$1 AND id = \$2/i.test(text)) {
        return { rows: [sampleAccountRow({ id: params[1] })] };
      }
      if (/WHERE tenant_id = \$1 AND open_id = \$2/i.test(text)) {
        return { rows: [sampleAccountRow({ open_id: params[1] })] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  const byId = await repo.getAccountById(TENANT_A, '33333333-3333-4333-8333-333333333333');
  assert.equal(byId.id, '33333333-3333-4333-8333-333333333333');

  const byOpenId = await repo.getAccountByOpenId(TENANT_A, 'tt_open_123');
  assert.equal(byOpenId.openId, 'tt_open_123');
});

test('disconnectAccount marks status disconnected and revokes stored token', async () => {
  const db = createFakeDb([
    (text) => {
      if (/UPDATE tiktok_accounts SET/i.test(text)) {
        return { rows: [sampleAccountRow({ status: 'disconnected', access_token_ciphertext: 'REVOKED', refresh_token_ciphertext: null })] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  const res = await repo.disconnectAccount(TENANT_A, '33333333-3333-4333-8333-333333333333', { actorId: 'usr_123' });
  assert.equal(res.disconnected, true);
  assert.equal(res.account.status, 'disconnected');
  assert.equal(res.account.accessTokenCiphertext, 'REVOKED');
  assert.equal(res.account.refreshTokenCiphertext, null);
});

test('refreshTokenWithLock reuses refreshed token when valid and does not call refreshFn', async () => {
  const futureExpiry = new Date(Date.now() + 300_000).toISOString(); // 5 minutes in future
  const db = createFakeDb([
    (text) => {
      if (/FOR UPDATE/i.test(text)) {
        return { rows: [sampleAccountRow({ token_expires_at: futureExpiry })] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  let refreshCalled = false;
  const result = await repo.refreshTokenWithLock(TENANT_A, '33333333-3333-4333-8333-333333333333', async () => {
    refreshCalled = true;
    return {};
  });

  assert.equal(refreshCalled, false, 'refreshFn should NOT be called when token was already refreshed');
  assert.equal(result.reused, true);
  assert.equal(result.refreshed, false);
});

test('refreshTokenWithLock locks row, calls refreshFn on expired token, and increments token_version', async () => {
  const expiredTime = new Date(Date.now() - 60_000).toISOString(); // expired 1 min ago
  const newExpiry = new Date(Date.now() + 7200_000).toISOString();
  const db = createFakeDb([
    (text) => {
      if (/FOR UPDATE/i.test(text)) {
        return { rows: [sampleAccountRow({ token_expires_at: expiredTime, token_version: 1 })] };
      }
      if (/UPDATE tiktok_accounts SET/i.test(text)) {
        return { rows: [sampleAccountRow({
          access_token_ciphertext: 'enc_new_access',
          refresh_token_ciphertext: 'enc_new_refresh',
          token_expires_at: newExpiry,
          token_version: 2
        })] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  let refreshCalled = false;
  const result = await repo.refreshTokenWithLock(TENANT_A, '33333333-3333-4333-8333-333333333333', async (account) => {
    refreshCalled = true;
    assert.equal(account.openId, 'tt_open_123');
    return {
      accessTokenCiphertext: 'enc_new_access',
      refreshTokenCiphertext: 'enc_new_refresh',
      tokenExpiresAt: newExpiry
    };
  });

  assert.equal(refreshCalled, true);
  assert.equal(result.refreshed, true);
  assert.equal(result.reused, false);
  assert.equal(result.account.tokenVersion, 2);
  assert.equal(result.account.accessTokenCiphertext, 'enc_new_access');
});

test('refreshTokenWithLock handles refresh failure by setting reauth_required status', async () => {
  const expiredTime = new Date(Date.now() - 60_000).toISOString();
  let updatedStatus = null;
  const db = createFakeDb([
    (text) => {
      if (/FOR UPDATE/i.test(text)) {
        return { rows: [sampleAccountRow({ token_expires_at: expiredTime })] };
      }
      if (/UPDATE tiktok_accounts SET/i.test(text)) {
        updatedStatus = 'reauth_required';
        return { rows: [sampleAccountRow({ status: 'reauth_required', last_error: 'refresh token revoked' })] };
      }
      return undefined;
    }
  ]);

  const repo = createTikTokAccountsRepo({ db });
  await assert.rejects(
    async () => repo.refreshTokenWithLock(TENANT_A, '33333333-3333-4333-8333-333333333333', async () => {
      const err = new Error('refresh token revoked');
      err.code = 'REAUTH_REQUIRED';
      throw err;
    }),
    (err) => err.code === 'REAUTH_REQUIRED'
  );

  assert.equal(updatedStatus, 'reauth_required');
});
