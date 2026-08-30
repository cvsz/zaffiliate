import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, PasswordPolicy } from '../packages/security/src/passwords.js';

test('passwords use the dependency-free scrypt contract and verify constant-size hashes', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword(encoded, 'correct horse battery staple'), true);
  assert.equal(await verifyPassword(encoded, 'wrong password'), false);
  assert.equal(PasswordPolicy.algorithm, 'scrypt');
});

test('password verifier fails closed for malformed hashes and weak passwords are rejected', async () => {
  assert.equal(await verifyPassword('not-a-valid-hash', 'whatever'), false);
  await assert.rejects(() => hashPassword('short'), (error) => error?.code === 'WEAK_PASSWORD');
});
