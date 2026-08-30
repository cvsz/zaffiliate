import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../packages/security/src/secret-envelope.js';

const KEY = '0123456789abcdef0123456789abcdef-extra-entropy';
const AAD = 'zaffiliate:test:oauth:tenant:user:provider';

function fixedRandom(bytes) {
  return Buffer.alloc(bytes, 0x42);
}

test('secret envelope round-trips without exposing plaintext', () => {
  const encrypted = encryptSecret('sensitive-refresh-token', { key: KEY, aad: AAD, randomBytesFn: fixedRandom });
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes('sensitive-refresh-token'), false);
  assert.equal(decryptSecret(encrypted, { key: KEY, aad: AAD }), 'sensitive-refresh-token');
});

test('secret envelope fails closed on tampering, wrong AAD, and weak keys', () => {
  const encrypted = encryptSecret('access-token', { key: KEY, aad: AAD, randomBytesFn: fixedRandom });
  const parts = encrypted.split('.');
  const tampered = [parts[0], parts[1], parts[2], parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A')].join('.');
  assert.throws(() => decryptSecret(tampered, { key: KEY, aad: AAD }), (error) => error.code === 'SECRET_ENVELOPE_INVALID');
  assert.throws(() => decryptSecret(encrypted, { key: KEY, aad: `${AAD}:other` }), (error) => error.code === 'SECRET_ENVELOPE_INVALID');
  assert.throws(() => encryptSecret('x', { key: 'too-short', aad: AAD }), /at least 32 characters/);
});
