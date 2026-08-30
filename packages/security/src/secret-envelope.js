import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(value) {
  const secret = String(value ?? '');
  if (secret.length < 32) {
    const error = new Error('encryption key must be at least 32 characters');
    error.code = 'ENCRYPTION_KEY_WEAK';
    throw error;
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

function aadBuffer(aad) {
  const value = String(aad ?? '');
  if (!value) throw new Error('authenticated-data context is required');
  return Buffer.from(value, 'utf8');
}

export function encryptSecret(value, { key, aad, randomBytesFn = randomBytes } = {}) {
  const plaintext = String(value ?? '');
  if (!plaintext) throw new TypeError('secret value must be a non-empty string');
  if (typeof randomBytesFn !== 'function') throw new TypeError('randomBytesFn must be a function');
  const iv = randomBytesFn(IV_BYTES);
  if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) throw new Error('randomBytesFn must return a 12-byte Buffer');
  const cipher = createCipheriv(ALGORITHM, encryptionKey(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadBuffer(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(envelope, { key, aad } = {}) {
  try {
    const parts = String(envelope ?? '').split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('unsupported secret envelope');
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length < 1) throw new Error('invalid secret envelope');
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(key), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadBuffer(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    const wrapped = new Error('secret envelope authentication failed');
    wrapped.code = 'SECRET_ENVELOPE_INVALID';
    wrapped.cause = error;
    throw wrapped;
  }
}
