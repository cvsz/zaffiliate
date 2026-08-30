import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAuthService } from '../apps/api/src/auth-service.js';
import { hashPassword, verifyPassword } from '../packages/security/src/passwords.js';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = 'usr_00000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-08-31T00:00:00.000Z').getTime();

function createFakeRepo({ credentials = null } = {}) {
  const calls = [];
  return {
    calls,
    async createTenantOwner(input) {
      calls.push(['createTenantOwner', input]);
      return { tenantId: input.tenantId, userId: input.userId, email: input.email, emailVerified: false, createdAt: new Date(NOW).toISOString() };
    },
    async findCredentialsByEmail(tenantId, email) {
      calls.push(['findCredentialsByEmail', tenantId, email]);
      return credentials;
    },
    async findUserById() { return credentials; },
    async createSession(input) {
      calls.push(['createSession', input]);
      return { id: 'session-1', ...input };
    },
    async findSessionByHash(tenantId, tokenHash) {
      calls.push(['findSessionByHash', tenantId, tokenHash]);
      return { id: 'session-1', tenantId, userId: USER, email: 'owner@example.test', role: 'owner', emailVerified: false, expiresAt: new Date(NOW + 60_000).toISOString(), revokedAt: null };
    },
    async revokeSession(tenantId, tokenHash) {
      calls.push(['revokeSession', tenantId, tokenHash]);
      return { id: 'session-1', userId: USER };
    },
    async auditLoginFailure(...args) { calls.push(['auditLoginFailure', ...args]); },
    async createRecoveryToken(input) { calls.push(['createRecoveryToken', input]); return { id: 'recovery-1', expiresAt: input.expiresAt }; },
    async confirmEmailVerification(input) { calls.push(['confirmEmailVerification', input]); return { userId: USER }; },
    async resetPassword(input) { calls.push(['resetPassword', input]); return { userId: USER }; }
  };
}

test('registration stores a derived password and creates an owner in a fresh tenant', async () => {
  const repo = createFakeRepo();
  const service = createLocalAuthService({ repo, clock: () => NOW });
  const user = await service.register({ orgName: 'Example Org', email: 'Owner@Example.test', password: 'strong-password-123' });
  assert.equal(user.role, 'owner');
  assert.equal(user.email, 'owner@example.test');
  const input = repo.calls.find(([name]) => name === 'createTenantOwner')[1];
  assert.notEqual(input.passwordHash, 'strong-password-123');
  assert.equal(await verifyPassword(input.passwordHash, 'strong-password-123'), true);
  assert.match(input.userId, /^usr_/);
});

test('login issues a high-entropy token while persistence receives only its hash', async () => {
  const passwordHash = await hashPassword('strong-password-123');
  const repo = createFakeRepo({ credentials: { tenantId: TENANT, userId: USER, email: 'owner@example.test', passwordHash, role: 'owner', emailVerified: false, createdAt: new Date(NOW).toISOString() } });
  const service = createLocalAuthService({ repo, clock: () => NOW });
  const session = await service.login({ tenantId: TENANT, email: 'owner@example.test', password: 'strong-password-123' });
  assert.match(session.token, /^zs_/);
  const persisted = repo.calls.find(([name]) => name === 'createSession')[1];
  assert.notEqual(persisted.tokenHash, session.token);
  assert.equal(persisted.tokenHash.length, 64);
});

test('password reset is anti-enumeration and raw recovery tokens are never persisted', async () => {
  const passwordHash = await hashPassword('strong-password-123');
  const credentials = { tenantId: TENANT, userId: USER, email: 'owner@example.test', passwordHash, role: 'owner', emailVerified: false, createdAt: new Date(NOW).toISOString() };
  const repo = createFakeRepo({ credentials });
  let deliveredToken = null;
  const sender = {
    async sendPasswordReset(_email, token) { deliveredToken = token; },
    async sendEmailVerification() {}
  };
  const service = createLocalAuthService({ repo, clock: () => NOW, sender });
  const response = await service.requestPasswordReset({ tenantId: TENANT, email: credentials.email });
  assert.deepEqual(response, { accepted: true });
  assert.match(deliveredToken, /^zr_/);
  const persisted = repo.calls.find(([name]) => name === 'createRecoveryToken')[1];
  assert.notEqual(persisted.tokenHash, deliveredToken);
  assert.equal(persisted.tokenHash.length, 64);

  const unknownRepo = createFakeRepo({ credentials: null });
  const unknown = createLocalAuthService({ repo: unknownRepo, clock: () => NOW, sender });
  assert.deepEqual(await unknown.requestPasswordReset({ tenantId: TENANT, email: 'missing@example.test' }), { accepted: true });
  assert.equal(unknownRepo.calls.some(([name]) => name === 'createRecoveryToken'), false);
});

test('password reset passes a new derived hash to the atomic repo reset operation', async () => {
  const repo = createFakeRepo();
  const service = createLocalAuthService({ repo, clock: () => NOW });
  const result = await service.resetPassword({ tenantId: TENANT, token: 'zr_valid-token', newPassword: 'new-strong-password-456' });
  assert.equal(result.reset, true);
  const input = repo.calls.find(([name]) => name === 'resetPassword')[1];
  assert.notEqual(input.passwordHash, 'new-strong-password-456');
  assert.equal(await verifyPassword(input.passwordHash, 'new-strong-password-456'), true);
  assert.notEqual(input.tokenHash, 'zr_valid-token');
});
