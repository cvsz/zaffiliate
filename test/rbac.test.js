import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHZ_ACTIONS, canRole, requireRoleAction } from '../packages/security/src/rbac.js';

test('human roles receive only explicitly allowed tenant actions', () => {
  assert.equal(canRole('viewer', 'commerce:read'), true);
  assert.equal(canRole('viewer', 'automation:write'), false);
  assert.equal(canRole('affiliate', 'content:write'), true);
  assert.equal(canRole('affiliate', 'automation:read'), false);
  assert.equal(canRole('operator', 'intelligence:feedback'), true);
  assert.equal(canRole('operator', 'audit:read'), false);
  assert.equal(canRole('admin', 'audit:read'), true);
  assert.equal(canRole('owner', 'tenant:admin'), true);
});

test('service and unknown roles fail closed for human business actions', () => {
  for (const action of AUTHZ_ACTIONS) {
    assert.equal(canRole('service', action), false, `service must not inherit human action ${action}`);
    assert.equal(canRole('unknown', action), false);
  }
  assert.equal(canRole('owner', 'made-up:action'), false);
  assert.throws(() => requireRoleAction('owner', 'made-up:action'), (error) => error.code === 'AUTHZ_ACTION_UNKNOWN');
  assert.throws(() => requireRoleAction('viewer', 'automation:write'), (error) => error.code === 'FORBIDDEN' && error.status === 403);
});
