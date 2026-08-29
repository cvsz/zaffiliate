import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIdentityBillingRuntime } from '../packages/identity-billing/src/runtime.js';

test('sessions fail closed on expiry, revocation and unknown tokens', () => {
  let now = 1_750_000_000_000;
  const runtime = createIdentityBillingRuntime({ clock: () => now });
  const user = runtime.createUser({ tenantId: 't1', subject: 'alice', claims: { email: 'alice@example.test' } });
  const session = runtime.startSession(user.userId, { ttlMinutes: 10 });
  assert.match(session.token, /^zs_/);
  assert.equal(new Date(session.expiresAt).getTime(), now + 10 * 60_000);
  const active = runtime.verifySession(session.token);
  assert.equal(active.valid, true);
  assert.equal(active.session.userId, user.userId);
  now += 10 * 60_000;
  const expired = runtime.verifySession(session.token);
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'session_expired');
  assert.equal(expired.session, null);
  const other = runtime.startSession(user.userId, { ttlMinutes: 10 });
  runtime.revokeSession(other.token);
  const revoked = runtime.verifySession(other.token);
  assert.equal(revoked.valid, false);
  assert.equal(revoked.reason, 'session_revoked');
  const unknown = runtime.verifySession('zs_missing');
  assert.equal(unknown.valid, false);
  assert.equal(unknown.reason, 'session_not_found');
  assert.throws(() => runtime.startSession('usr_none', { ttlMinutes: 5 }), /user not found/);
  assert.throws(() => runtime.startSession(user.userId, { ttlMinutes: 0 }), /positive integer/);
});

test('external identities are unique per issuer and subject and passwords are never stored', () => {
  const runtime = createIdentityBillingRuntime();
  const user = runtime.createUser({ tenantId: 't1', subject: 'bob' });
  runtime.linkExternalIdentity({ userId: user.userId, issuer: 'https://idp.example', issuerSubject: 'sub-1' });
  assert.throws(() => runtime.linkExternalIdentity({ userId: user.userId, issuer: 'https://idp.example', issuerSubject: 'sub-1' }), /already linked/);
  const second = runtime.createUser({ tenantId: 't1', subject: 'carol' });
  assert.throws(() => runtime.linkExternalIdentity({ userId: second.userId, issuer: 'https://idp.example', issuerSubject: 'sub-1' }), /already linked/);
  runtime.linkExternalIdentity({ userId: second.userId, issuer: 'https://idp.example', issuerSubject: 'sub-2' });
  assert.throws(() => runtime.createUser({ tenantId: 't1', subject: 'dave', claims: { password: 'hunter2' } }), /password/i);
  assert.throws(() => runtime.linkExternalIdentity({ userId: 'usr_none', issuer: 'https://idp.example', issuerSubject: 'sub-9' }), /user not found/);
});

test('api keys store only hashes, scope actions strictly and revoke immediately', () => {
  const runtime = createIdentityBillingRuntime();
  const issued = runtime.issueApiKey({ tenantId: 't1', actorId: 'svc-core', scopes: ['Affiliate:Read'], actions: ['affiliate.publish'] });
  assert.match(issued.token, /^za_[A-Za-z0-9_-]{32}$/);
  const records = runtime._hooks.rawApiKeyRecords();
  assert.equal(JSON.stringify(records).includes(issued.token), false);
  const record = records.find((item) => item.keyId === issued.keyId);
  assert.equal(record.token, undefined);
  assert.equal(record.tokenHash, createHash('sha256').update(issued.token).digest('hex'));
  assert.equal(runtime.authenticateApiKey(issued.token, 'affiliate.publish').authenticated, true);
  assert.equal(runtime.authenticateApiKey(issued.token, 'AFFILIATE.PUBLISH').authenticated, true);
  const denied = runtime.authenticateApiKey(issued.token, 'affiliate.delete');
  assert.equal(denied.authenticated, false);
  assert.equal(denied.reason, 'action_denied');
  const unknown = runtime.authenticateApiKey(`za_${'a'.repeat(32)}`, 'affiliate.publish');
  assert.equal(unknown.authenticated, false);
  assert.equal(unknown.reason, 'unknown_key');
  runtime.revokeApiKey(issued.keyId);
  const revoked = runtime.authenticateApiKey(issued.token, 'affiliate.publish');
  assert.equal(revoked.authenticated, false);
  assert.equal(revoked.reason, 'revoked');
  const disabledKey = runtime.issueApiKey({ tenantId: 't1', actorId: 'svc-core', scopes: ['scope'], actions: ['widget.build'] });
  runtime.disableApiKey(disabledKey.keyId);
  const disabled = runtime.authenticateApiKey(disabledKey.token, 'widget.build');
  assert.equal(disabled.authenticated, false);
  assert.equal(disabled.reason, 'disabled');
  assert.throws(() => runtime.issueApiKey({ tenantId: 't1', actorId: 'svc-core', scopes: [], actions: ['a'] }), /at least one scopes entry/);
});

test('usage meters reject quota excess fail-closed and keep events immutable', () => {
  const runtime = createIdentityBillingRuntime();
  runtime.definePlan({ planId: 'pro', quotas: { publishes_per_month: 3 }, ratePlan: { publishes_per_month: 500 }, features: ['analytics'] });
  runtime.assignEntitlement('t1', 'pro', '2026-08');
  for (let index = 0; index < 3; index += 1) {
    runtime.meterUsage({ tenantId: 't1', metric: 'publishes_per_month', quantity: 1, at: '2026-08-10T00:00:00Z' });
  }
  assert.throws(
    () => runtime.meterUsage({ tenantId: 't1', metric: 'publishes_per_month', quantity: 1 }),
    (error) => error.reason === 'quota_exceeded'
  );
  assert.throws(
    () => runtime.meterUsage({ tenantId: 't1', metric: 'undefined_metric', quantity: 1 }),
    (error) => error.reason === 'quota_undefined'
  );
  assert.throws(
    () => runtime.meterUsage({ tenantId: 'ghost', metric: 'publishes_per_month', quantity: 1 }),
    (error) => error.reason === 'quota_undefined'
  );
  const events = runtime.listUsageEvents('t1');
  assert.equal(events.length, 3);
  assert.equal(Object.isFrozen(events), true);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.throws(() => {
    events[0].quantity = 99;
  }, TypeError);
});

test('ledger enforces balance, monotonic sequences and reconciliation detects corruption', () => {
  const runtime = createIdentityBillingRuntime();
  const first = runtime.postLedgerEntry({
    tenantId: 't1',
    debit: { account: 'cash', amountMinorUnits: 100 },
    credit: { account: 'revenue', amountMinorUnits: 100 },
    ref: 'ref-1'
  });
  assert.equal(first.sequence, 1);
  runtime.postLedgerEntry({
    tenantId: 't1',
    debit: { account: 'cash', amountMinorUnits: 200 },
    credit: { account: 'revenue', amountMinorUnits: 200 },
    ref: 'ref-2'
  });
  assert.throws(
    () => runtime.postLedgerEntry({
      tenantId: 't1',
      debit: { account: 'cash', amountMinorUnits: 100 },
      credit: { account: 'revenue', amountMinorUnits: 90 },
      ref: 'ref-3'
    }),
    /not balanced/
  );
  assert.throws(
    () => runtime.postLedgerEntry({
      tenantId: 't1',
      debit: { account: 'cash', amountMinorUnits: 100.5 },
      credit: { account: 'revenue', amountMinorUnits: 100.5 },
      ref: 'ref-4'
    }),
    /minor units/
  );
  assert.throws(
    () => runtime.postLedgerEntry({
      tenantId: 't1',
      debit: { account: 'cash', amountMinorUnits: -5 },
      credit: { account: 'revenue', amountMinorUnits: -5 },
      ref: 'ref-5'
    }),
    /minor units/
  );
  const clean = runtime.reconcileLedger('t1');
  assert.equal(clean.balanced, true);
  assert.equal(clean.sequencesContinuous, true);
  assert.equal(clean.valid, true);
  assert.equal(clean.totalDebitMinorUnits, 300);
  runtime._hooks.corruptLedgerEntry('t1', 1, (entry) => {
    entry.credit.amountMinorUnits += 7;
  });
  const imbalanced = runtime.reconcileLedger('t1');
  assert.equal(imbalanced.balanced, false);
  assert.equal(imbalanced.sequencesContinuous, true);
  assert.equal(imbalanced.totalCreditMinorUnits, 307);
  assert.equal(imbalanced.valid, false);
  runtime._hooks.corruptLedgerEntry('t1', 2, (entry) => {
    entry.sequence = 42;
  });
  const broken = runtime.reconcileLedger('t1');
  assert.equal(broken.sequencesContinuous, false);
  assert.equal(broken.valid, false);
});

test('invoices aggregate metered usage and track partial and over payments', () => {
  const runtime = createIdentityBillingRuntime();
  runtime.definePlan({ planId: 'starter', quotas: { messages: 50 }, ratePlan: { messages: 250 }, features: [] });
  runtime.assignEntitlement('t2', 'starter', '2026-08');
  runtime.meterUsage({ tenantId: 't2', metric: 'messages', quantity: 4, at: '2026-08-05T00:00:00Z' });
  runtime.meterUsage({ tenantId: 't2', metric: 'messages', quantity: 6, at: '2026-08-20T12:00:00Z' });
  const invoice = runtime.draftInvoice({ tenantId: 't2', periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z' });
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.lineItems.length, 1);
  assert.deepEqual({ ...invoice.lineItems[0] }, { metric: 'messages', quantity: 10, unitPriceMinorUnits: 250, amountMinorUnits: 2500 });
  assert.equal(invoice.totalMinorUnits, 2500);
  const issued = runtime.issueInvoice(invoice.invoiceId);
  assert.equal(issued.status, 'issued');
  assert.ok(issued.issuedAt);
  assert.throws(() => runtime.issueInvoice(invoice.invoiceId), /already issued/);
  assert.throws(() => runtime.draftInvoice({ tenantId: 't2', periodStart: 'bad', periodEnd: '2026-09-01T00:00:00Z' }), /valid timestamp/);
  const partial = runtime.recordPayment({ invoiceId: invoice.invoiceId, amountMinorUnits: 1000, providerRef: 'pay-1' });
  assert.equal(partial.status, 'partially_paid');
  assert.equal(partial.paidMinorUnits, 1000);
  assert.equal(partial.outstandingMinorUnits, 1500);
  const settled = runtime.recordPayment({ invoiceId: invoice.invoiceId, amountMinorUnits: 1500, providerRef: 'pay-2' });
  assert.equal(settled.status, 'paid');
  assert.equal(settled.outstandingMinorUnits, 0);
  const over = runtime.recordPayment({ invoiceId: invoice.invoiceId, amountMinorUnits: 500, providerRef: 'pay-3' });
  assert.equal(over.status, 'paid');
  assert.equal(over.paidMinorUnits, 3000);
  assert.equal(over.overpaymentMinorUnits, 500);
  assert.throws(() => runtime.recordPayment({ invoiceId: invoice.invoiceId, amountMinorUnits: 0, providerRef: 'pay-4' }), /minor units/);
  const draft = runtime.draftInvoice({ tenantId: 't2', periodStart: '2026-08-01T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z' });
  assert.throws(() => runtime.recordPayment({ invoiceId: draft.invoiceId, amountMinorUnits: 100, providerRef: 'pay-5' }), /draft/);
});

test('admin bootstrap is one-time and disabling is permanent for the process', () => {
  let now = 1_750_000_000_000;
  const runtime = createIdentityBillingRuntime({ clock: () => now });
  const grant = runtime.provisionAdminBootstrap({ tenantId: 't5', ttlMinutes: 15 });
  assert.equal(grant.role, 'admin');
  assert.match(grant.token, /^zb_/);
  assert.equal(new Date(grant.expiresAt).getTime(), now + 15 * 60_000);
  assert.throws(() => runtime.provisionAdminBootstrap({ tenantId: 't5', ttlMinutes: 15 }), /already active/);
  runtime.disableBootstrap('t5');
  now += 60 * 60_000;
  assert.throws(() => runtime.provisionAdminBootstrap({ tenantId: 't5', ttlMinutes: 15 }), /bootstrap_disabled/);
  assert.throws(() => runtime.provisionAdminBootstrap({ tenantId: 't5', ttlMinutes: 15 }), /bootstrap_disabled/);
  const otherTenantGrant = runtime.provisionAdminBootstrap({ tenantId: 't6', ttlMinutes: 5 });
  assert.equal(otherTenantGrant.tenantId, 't6');
});

test('escalation log captures every privilege grant completely', () => {
  const runtime = createIdentityBillingRuntime();
  runtime.definePlan({ planId: 'audit-plan', quotas: { ops: 10 }, ratePlan: {}, features: [] });
  const user = runtime.createUser({ tenantId: 't4', subject: 'erin' });
  runtime.registerServiceIdentity({ tenantId: 't4', serviceId: 'svc-ops', allowedActions: ['sync.run'] });
  runtime.linkExternalIdentity({ userId: user.userId, issuer: 'https://idp.example', issuerSubject: 'erin-sub' });
  runtime.assignEntitlement('t4', 'audit-plan', '2026-08');
  const key = runtime.issueApiKey({ tenantId: 't4', actorId: 'svc-ops', scopes: ['audit:read'], actions: ['audit.read'] });
  runtime.revokeApiKey(key.keyId);
  runtime.provisionAdminBootstrap({ tenantId: 't4', ttlMinutes: 5 });
  runtime.disableBootstrap('t4');
  const log = runtime.getEscalationLog('t4');
  assert.deepEqual(log.map((entry) => entry.action), [
    'user.create',
    'service_identity.register',
    'identity.link',
    'entitlement.assign',
    'api_key.issue',
    'api_key.revoke',
    'bootstrap.provision',
    'bootstrap.disable'
  ]);
  for (const entry of log) {
    assert.equal(entry.tenantId, 't4');
    assert.ok(entry.at);
    assert.ok(entry.actorId);
    assert.ok(entry.target);
    assert.equal(Number.isNaN(new Date(entry.at).getTime()), false);
    assert.equal(Object.isFrozen(entry), true);
  }
  const issuance = log.find((entry) => entry.action === 'api_key.issue');
  assert.equal(issuance.actorId, 'svc-ops');
  assert.equal(issuance.target, key.keyId);
  assert.equal(Object.isFrozen(log), true);
});
