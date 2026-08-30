import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createOAuthLoginRepo, oauthIdentityHash } from '../packages/db/src/oauth-login-repo.js';

const RUN = process.env.OIDC_LOGIN_DB_INTEGRATION === '1';
const CONNECTION = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/zaffiliate_test';

function appRoleDb(pool) {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE zaffiliate_app_test');
        const result = await fn({ query: (text, params) => client.query(text, params) });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

test('OIDC login repo persists single-use state and creates/reuses the verified identity tenant', { skip: !RUN }, async (t) => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: CONNECTION });
  t.after(() => pool.end());
  const repo = createOAuthLoginRepo({ db: appRoleDb(pool) });

  const pending = await repo.createPendingLogin({
    provider: 'acme',
    issuer: 'https://idp.example/',
    stateHash: '4'.repeat(64),
    authorizationCiphertext: 'ciphertext-'.padEnd(64, 'x'),
    expiresAt: new Date(Date.now() + 600_000)
  });
  assert.equal(pending.provider, 'acme');
  assert.ok(await repo.consumePendingLogin({ provider: 'acme', stateHash: '4'.repeat(64) }));
  assert.equal(await repo.consumePendingLogin({ provider: 'acme', stateHash: '4'.repeat(64) }), null);

  const first = await repo.completeOidcLogin({
    provider: 'acme',
    issuer: 'https://idp.example/',
    issuerSubject: 'verified-subject-d4',
    email: 'oidc-d4@example.test',
    emailVerified: true,
    newTenantId: '40000000-0000-4000-8000-0000000000d4',
    newTenantSlug: 'oidc-d4',
    newTenantName: 'personal',
    newUserId: 'usr_oidc_d4',
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert.equal(first.registered, true);
  assert.equal(first.user.tenantId, '40000000-0000-4000-8000-0000000000d4');
  assert.equal(first.user.userId, 'usr_oidc_d4');
  assert.equal(first.user.emailVerified, true);
  assert.equal(first.user.role, 'owner');

  const identityHash = oauthIdentityHash('https://idp.example/', 'verified-subject-d4');
  const directory = await pool.query(
    'SELECT tenant_id::text AS "tenantId", user_id AS "userId" FROM oauth_identity_directory WHERE identity_hash=$1',
    [identityHash]
  );
  assert.deepEqual(directory.rows[0], { tenantId: '40000000-0000-4000-8000-0000000000d4', userId: 'usr_oidc_d4' });
  const storedUser = await pool.query(
    'SELECT password_hash AS "passwordHash", email_verified AS "emailVerified" FROM local_auth_users WHERE tenant_id=$1 AND user_id=$2',
    ['40000000-0000-4000-8000-0000000000d4', 'usr_oidc_d4']
  );
  assert.equal(storedUser.rows[0].emailVerified, true);
  assert.equal(storedUser.rows[0].passwordHash.startsWith('scrypt$'), false, 'OIDC-only bootstrap must not invent a usable local password');

  const second = await repo.completeOidcLogin({
    provider: 'acme',
    issuer: 'https://idp.example/',
    issuerSubject: 'verified-subject-d4',
    email: 'attacker-controlled-change@example.test',
    emailVerified: true,
    newTenantId: '50000000-0000-4000-8000-0000000000e5',
    newTenantSlug: 'must-not-be-created',
    newTenantName: 'personal',
    newUserId: 'usr_must_not_be_created',
    tokenHash: 'b'.repeat(64),
    expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert.equal(second.registered, false);
  assert.equal(second.user.tenantId, first.user.tenantId);
  assert.equal(second.user.userId, first.user.userId);
  assert.equal(second.user.email, 'oidc-d4@example.test', 'subsequent signed claims must not silently rewrite the local account email');
  const unusedTenant = await pool.query('SELECT count(*)::int AS count FROM tenants WHERE id=$1', ['50000000-0000-4000-8000-0000000000e5']);
  assert.equal(unusedTenant.rows[0].count, 0);
  const sessions = await pool.query('SELECT count(*)::int AS count FROM auth_sessions WHERE tenant_id=$1 AND user_id=$2', [first.user.tenantId, first.user.userId]);
  assert.equal(sessions.rows[0].count, 2);
});

test('verified email equality never auto-links a different tenant without an existing identity', { skip: !RUN }, async (t) => {
  const { Pool } = pg;
  const pool = new Pool({ connectionString: CONNECTION });
  t.after(() => pool.end());
  const repo = createOAuthLoginRepo({ db: appRoleDb(pool) });

  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ('60000000-0000-4000-8000-0000000000f6','existing-email-f6','Existing Email')");
  await pool.query("INSERT INTO tenant_memberships (tenant_id,user_id,role) VALUES ('60000000-0000-4000-8000-0000000000f6','usr_existing_email','owner')");
  await pool.query("INSERT INTO local_auth_users (tenant_id,user_id,email,password_hash,email_verified) VALUES ('60000000-0000-4000-8000-0000000000f6','usr_existing_email','shared@example.test',$1,true)", ['z'.repeat(64)]);

  const result = await repo.completeOidcLogin({
    provider: 'acme',
    issuer: 'https://idp.example/',
    issuerSubject: 'brand-new-subject-f7',
    email: 'shared@example.test',
    emailVerified: true,
    newTenantId: '70000000-0000-4000-8000-0000000000a7',
    newTenantSlug: 'new-identity-a7',
    newTenantName: 'personal',
    newUserId: 'usr_new_identity_a7',
    tokenHash: 'c'.repeat(64),
    expiresAt: new Date(Date.now() + 3_600_000)
  });
  assert.equal(result.registered, true);
  assert.equal(result.user.tenantId, '70000000-0000-4000-8000-0000000000a7');
  assert.equal(result.user.userId, 'usr_new_identity_a7');
  assert.equal(result.user.email, 'shared@example.test');
});
