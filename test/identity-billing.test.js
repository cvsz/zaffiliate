import test from 'node:test';
import assert from 'node:assert/strict';
import { createMembership, authorizeRole, createApiKeyMetadata, requireApiScope, createPlan, checkQuota, createLedgerTransaction } from '../packages/identity-billing/src/domain.js';

test('role authorization is tenant-bound', () => {
  const membership = createMembership({ tenantId: 't1', userId: 'u1', role: 'operator' });
  assert.equal(authorizeRole({ membership, tenantId: 't1', allowedRoles: ['operator','admin'] }).allowed, true);
  assert.deepEqual(authorizeRole({ membership, tenantId: 't2', allowedRoles: ['operator'] }), { allowed: false, reason: 'tenant_mismatch' });
});

test('API key metadata enforces scope, tenant and expiry', () => {
  const apiKey = createApiKeyMetadata({ tenantId: 't1', keyId: 'k1', actorId: 'svc1', scopes: ['affiliate:read','affiliate:write'], expiresAt: '2026-08-23T00:00:00Z' });
  assert.equal(requireApiScope({ apiKey, tenantId: 't1', scope: 'affiliate:write', now: new Date('2026-08-22T12:00:00Z') }), true);
  assert.throws(() => requireApiScope({ apiKey, tenantId: 't2', scope: 'affiliate:write' }), (error) => error.code === 'API_KEY_TENANT_MISMATCH');
  assert.throws(() => requireApiScope({ apiKey, tenantId: 't1', scope: 'admin:all' }), (error) => error.code === 'API_SCOPE_DENIED');
  assert.throws(() => requireApiScope({ apiKey, tenantId: 't1', scope: 'affiliate:read', now: new Date('2026-08-24T00:00:00Z') }), (error) => error.code === 'API_KEY_EXPIRED');
});

test('plan quotas fail closed when undefined and reject excess usage', () => {
  const plan = createPlan({ planId: 'pro', quotas: { publishes_per_month: 100 }, features: ['analytics'] });
  assert.equal(checkQuota({ plan, metric: 'publishes_per_month', used: 99, requested: 1 }).allowed, true);
  assert.equal(checkQuota({ plan, metric: 'publishes_per_month', used: 100, requested: 1 }).reason, 'quota_exceeded');
  assert.equal(checkQuota({ plan, metric: 'unknown', used: 0 }).reason, 'quota_undefined');
});

test('ledger requires balanced double-entry transaction', () => {
  const tx = createLedgerTransaction({
    tenantId: 't1', transactionId: 'tx1', currency: 'thb', referenceType: 'commission', referenceId: 'c1',
    entries: [
      { account: 'commission_receivable', debit: 100 },
      { account: 'commission_income', credit: 100 }
    ],
    occurredAt: '2026-08-22T12:00:00Z'
  });
  assert.equal(tx.total, 100);
  assert.equal(tx.currency, 'THB');
  assert.throws(() => createLedgerTransaction({ tenantId: 't1', transactionId: 'bad', currency: 'THB', referenceType: 'x', referenceId: 'x', entries: [{ account: 'a', debit: 100 }, { account: 'b', credit: 90 }] }), /not balanced/);
});
