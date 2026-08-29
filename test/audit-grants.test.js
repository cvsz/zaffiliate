import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInMemoryAuditStore, createAuditPersistenceAdapter, GENESIS_HASH } from '../packages/contracts/src/audit.js';
import { ROLES, roleRank, capabilitiesFor, createGrantSystem } from '../packages/contracts/src/grants.js';

function fixedClock(start = '2026-08-22T00:00:00.000Z') {
  let tick = 0;
  return () => {
    const next = new Date(Date.parse(start) + tick * 1000);
    tick += 1;
    return next.toISOString();
  };
}

function baseEvent(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    actor: { id: 'user-1', type: 'user' },
    action: 'campaign.publish',
    resource: { type: 'campaign', id: 'camp-1' },
    outcome: 'allow',
    ...overrides
  };
}

test('append rejects malformed events fail-closed', () => {
  const store = createInMemoryAuditStore({ clock: fixedClock() });
  assert.throws(() => store.append(baseEvent({ tenantId: '' })), /tenantId is required/);
  assert.throws(() => store.append({ action: 'x', resource: { type: 't', id: 'i' }, outcome: 'allow', tenantId: 'tenant-a' }), /actor is required/);
  assert.throws(() => store.append(baseEvent({ actor: { id: 'user-1', type: 'robot' } })), /unsupported actor type/);
  assert.throws(() => store.append(baseEvent({ outcome: 'partial' })), /unsupported outcome/);
  assert.throws(() => store.append(baseEvent({ action: '' })), /action is required/);
  assert.throws(() => store.append(baseEvent({ resource: { type: '', id: 'x' } })), /resource.type is required/);
  assert.throws(() => store.append(baseEvent({ resource: { type: 'campaign', id: '' } })), /resource.id is required/);
  assert.throws(() => store.append(baseEvent({ occurredAt: 'not-a-date' })), /valid timestamp/);
  assert.throws(() => store.append(null), TypeError);
});

test('append assigns monotonic per-tenant sequences and storedAt', () => {
  const clock = fixedClock();
  const store = createInMemoryAuditStore({ clock });
  const first = store.append(baseEvent());
  store.append(baseEvent({ tenantId: 'tenant-b', resource: { type: 'product', id: 'p-1' } }));
  const third = store.append(baseEvent({ resource: { type: 'campaign', id: 'camp-2' } }));
  assert.equal(first.sequence, 1);
  assert.equal(third.sequence, 2);
  const otherTenant = store.list('tenant-b')[0];
  assert.equal(otherTenant.sequence, 1);
  assert.equal(first.storedAt, '2026-08-22T00:00:00.000Z');
  assert.equal(third.storedAt, '2026-08-22T00:00:02.000Z');
  assert.equal(first.tenantId, 'tenant-a');
  assert.deepEqual(first.actor, { id: 'user-1', type: 'user' });
  assert.equal(first.traceId, null);
  assert.equal(first.occurredAt, first.storedAt);
});

test('stored entries are deeply immutable and store exposes only append-only APIs', () => {
  const store = createInMemoryAuditStore({ clock: fixedClock() });
  const entry = store.append(baseEvent({ traceId: 'trace-9' }));
  assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(entry.actor), true);
  assert.equal(Object.isFrozen(entry.resource), true);
  assert.throws(() => {
    entry.action = 'tampered';
  }, TypeError);
  assert.throws(() => {
    entry.actor.id = 'someone-else';
  }, TypeError);
  const listed = store.list('tenant-a');
  assert.equal(Object.isFrozen(listed), true);
  assert.deepEqual(Object.keys(store).sort(), ['_entriesFor', 'append', 'list', 'verifyChain']);
  assert.equal(entry.traceId, 'trace-9');
});

test('hash chain verifies clean and detects single-field tamper with brokenAt index', () => {
  const store = createInMemoryAuditStore({ clock: fixedClock() });
  store.append(baseEvent());
  store.append(baseEvent({ resource: { type: 'campaign', id: 'camp-2' } }));
  store.append(baseEvent({ resource: { type: 'campaign', id: 'camp-3' } }));
  assert.deepEqual(store.verifyChain('tenant-a'), { valid: true });
  const genesisEntry = store.list('tenant-a')[0];
  assert.equal(genesisEntry.prevHash, GENESIS_HASH);

  const raw = store._entriesFor('tenant-a');
  const clone = structuredClone(raw[1]);
  clone.action = 'campaign.tampered';
  raw[1] = clone;
  const result = store.verifyChain('tenant-a');
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 1);

  const freshStore = createInMemoryAuditStore({ clock: fixedClock() });
  freshStore.append(baseEvent());
  const firstRaw = freshStore._entriesFor('tenant-a');
  const firstClone = structuredClone(firstRaw[0]);
  firstClone.outcome = 'deny';
  firstRaw[0] = firstClone;
  assert.deepEqual(freshStore.verifyChain('tenant-a'), { valid: false, brokenAt: 0 });
});

test('list filters by actorId, action, outcome, fromSequence and limit in deterministic order', () => {
  const store = createInMemoryAuditStore({ clock: fixedClock() });
  store.append(baseEvent());
  store.append(baseEvent({ actor: { id: 'svc-1', type: 'service' }, action: 'product.sync', resource: { type: 'product', id: 'p-1' }, outcome: 'deny' }));
  store.append(baseEvent({ resource: { type: 'campaign', id: 'camp-2' } }));
  store.append(baseEvent({ actor: { id: 'svc-1', type: 'service' }, action: 'product.sync', resource: { type: 'product', id: 'p-2' }, outcome: 'deny' }));

  const all = store.list('tenant-a');
  assert.deepEqual(all.map((entry) => entry.sequence), [1, 2, 3, 4]);
  assert.deepEqual(store.list('tenant-a', { actorId: 'svc-1' }).map((entry) => entry.sequence), [2, 4]);
  assert.deepEqual(store.list('tenant-a', { action: 'product.sync', outcome: 'deny' }).map((entry) => entry.sequence), [2, 4]);
  assert.deepEqual(store.list('tenant-a', { fromSequence: 3 }).map((entry) => entry.sequence), [3, 4]);
  assert.deepEqual(store.list('tenant-a', { limit: 2 }).map((entry) => entry.sequence), [1, 2]);
  assert.deepEqual(store.list('tenant-a', { fromSequence: 2, limit: 1 }).map((entry) => entry.sequence), [2]);
  assert.equal(store.list('tenant-z').length, 0);
  assert.throws(() => store.list(), /tenantId is required/);
  assert.throws(() => store.list('tenant-a', { limit: 0 }), /limit must be a positive integer/);
  assert.throws(() => store.list('tenant-a', { fromSequence: -1 }), /fromSequence must be a positive integer/);
  assert.throws(() => store.list('tenant-a', { outcome: 'maybe' }), /unsupported outcome/);
});

test('replay port records through to the store and replays per tenant', () => {
  const store = createInMemoryAuditStore({ clock: fixedClock() });
  const adapter = createAuditPersistenceAdapter(store);
  adapter.record(baseEvent());
  adapter.record(baseEvent({ resource: { type: 'campaign', id: 'camp-2' } }));
  adapter.record(baseEvent({ tenantId: 'tenant-b', resource: { type: 'product', id: 'p-1' } }));

  const replayedA = adapter.replay('tenant-a');
  assert.deepEqual(replayedA.map((entry) => [entry.tenantId, entry.sequence]), [['tenant-a', 1], ['tenant-a', 2]]);
  const replayedFromSecond = adapter.replay('tenant-a', { fromSequence: 2 });
  assert.deepEqual(replayedFromSecond.map((entry) => entry.sequence), [2]);
  assert.deepEqual(Object.keys(adapter), ['record', 'replay']);
  assert.throws(() => adapter.replay(), /tenantId is required/);
  assert.throws(() => adapter.replay('tenant-a', { fromSequence: 1.5 }), /fromSequence must be a positive integer/);
  assert.throws(() => createAuditPersistenceAdapter(null), TypeError);
  assert.throws(() => createAuditPersistenceAdapter({ list: () => [] }), TypeError);
  assert.equal(store.verifyChain('tenant-a').valid, true);
  assert.equal(store.verifyChain('tenant-b').valid, true);
});

test('role matrix grants read execute manage export per level', () => {
  const grants = createGrantSystem({
    assignments: [
      { tenantId: 'tenant-a', actorId: 'owner-1', role: 'owner' },
      { tenantId: 'tenant-a', actorId: 'admin-1', role: 'admin' },
      { tenantId: 'tenant-a', actorId: 'op-1', role: 'operator' },
      { tenantId: 'tenant-a', actorId: 'analyst-1', role: 'analyst' },
      { tenantId: 'tenant-a', actorId: 'viewer-1', role: 'viewer' }
    ]
  });

  assert.equal(grants.grant('tenant-a', 'viewer-1', 'read:campaigns').allowed, true);
  assert.equal(grants.grant('tenant-a', 'viewer-1', 'execute:payout').allowed, false);
  assert.equal(grants.grant('tenant-a', 'analyst-1', 'export:analytics').allowed, true);
  assert.equal(grants.grant('tenant-a', 'analyst-1', 'execute:payout').allowed, false);
  assert.equal(grants.grant('tenant-a', 'op-1', 'execute:payout').allowed, true);
  assert.equal(grants.grant('tenant-a', 'op-1', 'manage:users').allowed, false);
  assert.equal(grants.grant('tenant-a', 'admin-1', 'manage:users').allowed, true);
  assert.equal(grants.grant('tenant-a', 'admin-1', 'read:anything').allowed, true);
  assert.equal(grants.grant('tenant-a', 'admin-1', 'export:ledger').allowed, false);
  assert.equal(grants.grant('tenant-a', 'owner-1', 'manage:roles').allowed, true);
  assert.equal(grants.grant('tenant-a', 'owner-1', 'export:ledger').allowed, true);
  assert.equal(grants.grant('tenant-a', 'nobody', 'read:campaigns').reason, 'no_role_assigned');
  assert.equal(grants.grant('tenant-a', 'viewer-1', 'read:campaigns').reason, 'granted');
  assert.equal(grants.roleFor('tenant-a', 'viewer-1'), 'viewer');

  assert.throws(() => grants.assignRole({ tenantId: 'tenant-a', actorId: 'x', role: 'superuser' }), /unknown role/);
  assert.throws(() => capabilitiesFor('superuser'), /unknown role/);
  assert.deepEqual(capabilitiesFor('viewer'), ['read_*']);
  assert.deepEqual(capabilitiesFor('operator'), ['read_*', 'execute_*']);
  assert.deepEqual(Object.keys(roleRank), ['owner', 'admin', 'operator', 'analyst', 'viewer']);
  assert.ok(roleRank.owner > roleRank.admin && roleRank.admin > roleRank.operator && roleRank.operator > roleRank.analyst && roleRank.analyst > roleRank.viewer);
});

test('unknown or malformed capability is denied fail-closed', () => {
  const grants = createGrantSystem({ assignments: [{ tenantId: 'tenant-a', actorId: 'admin-1', role: 'admin' }] });
  assert.deepEqual(grants.grant('tenant-a', 'admin-1', 'fly:to-the-moon'), { allowed: false, reason: 'unknown_capability' });
  assert.deepEqual(grants.grant('tenant-a', 'admin-1', 'read'), { allowed: false, reason: 'unknown_capability' });
  assert.deepEqual(grants.grant('tenant-a', 'admin-1', ':'), { allowed: false, reason: 'unknown_capability' });
  assert.deepEqual(grants.grant('tenant-a', 'admin-1', null), { allowed: false, reason: 'unknown_capability' });
  assert.deepEqual(grants.grant('tenant-a', 'admin-1', 'selfdestruct:* '), { allowed: false, reason: 'unknown_capability' });
  assert.throws(() => grants.grant('', 'admin-1', 'read:x'), /tenantId is required/);
  assert.throws(() => grants.grant('tenant-a', '', 'read:x'), /actorId is required/);
});

test('escalation guard enforces rank order and records attempts for audit', () => {
  const clock = fixedClock();
  const grants = createGrantSystem({ clock });
  grants.assignRole({ tenantId: 'tenant-a', actorId: 'owner-1', role: 'owner' });
  grants.assignRole({ tenantId: 'tenant-a', actorId: 'admin-1', role: 'admin' });
  grants.assignRole({ tenantId: 'tenant-a', actorId: 'op-1', role: 'operator' });

  const ownerPromotesAdmin = grants.attemptEscalation({ tenantId: 'tenant-a', actorId: 'owner-1', targetRole: 'admin' });
  assert.equal(ownerPromotesAdmin.allowed, true);
  assert.equal(ownerPromotesAdmin.reason, 'escalation_allowed');
  assert.equal(ownerPromotesAdmin.attempt.targetRole, 'admin');
  assert.equal(grants.roleFor('tenant-a', 'owner-1'), 'admin');

  const adminSeizesOwner = grants.attemptEscalation({ tenantId: 'tenant-a', actorId: 'admin-1', targetRole: 'owner' });
  assert.equal(adminSeizesOwner.allowed, false);
  assert.equal(adminSeizesOwner.reason, 'escalation_denied');
  assert.equal(grants.roleFor('tenant-a', 'admin-1'), 'admin');

  const operatorAttempt = grants.attemptEscalation({ tenantId: 'tenant-a', actorId: 'op-1', targetRole: 'viewer' });
  assert.deepEqual(
    { allowed: operatorAttempt.allowed, reason: operatorAttempt.reason },
    { allowed: false, reason: 'escalation_denied' }
  );
  const strangerAttempt = grants.attemptEscalation({ tenantId: 'tenant-a', actorId: 'ghost', targetRole: 'admin' });
  assert.equal(strangerAttempt.allowed, false);
  assert.throws(() => grants.attemptEscalation({ tenantId: 'tenant-a', actorId: 'owner-1', targetRole: 'emperor' }), /unknown target role/);

  const rows = grants.listEscalationAttempts({ tenantId: 'tenant-a' });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.reason), ['escalation_allowed', 'escalation_denied', 'escalation_denied', 'escalation_denied']);
  assert.deepEqual(rows[0], {
    at: '2026-08-22T00:00:00.000Z',
    tenantId: 'tenant-a',
    actorId: 'owner-1',
    actorRole: 'owner',
    targetRole: 'admin',
    allowed: true,
    reason: 'escalation_allowed'
  });
  assert.equal(Object.isFrozen(rows[1]), true);
  assert.equal(ROLES.VIEWER, 'viewer');
});
