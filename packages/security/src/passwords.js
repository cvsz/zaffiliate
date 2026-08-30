import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KDF_N = 32768;
const KDF_R = 8;
const KDF_P = 1;
const KDF_BYTES = 64;
const KDF_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    const error = new Error(`password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
    error.code = 'WEAK_PASSWORD';
    throw error;
  }
  return password;
}

async function derive(password, salt, { N = KDF_N, r = KDF_R, p = KDF_P, bytes = KDF_BYTES } = {}) {
  return Buffer.from(await scryptAsync(password, salt, bytes, { N, r, p, maxmem: KDF_MAXMEM }));
}

export async function hashPassword(password) {
  const value = validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await derive(value, salt);
  return `scrypt$${KDF_N}$${KDF_R}$${KDF_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(encoded, password) {
  if (typeof encoded !== 'string' || typeof password !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (N !== KDF_N || r !== KDF_R || p !== KDF_P) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KDF_BYTES) return false;
  try {
    const actual = await derive(password, salt, { N, r, p, bytes: expected.length });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export const PasswordPolicy = Object.freeze({
  minLength: MIN_PASSWORD_LENGTH,
  maxLength: MAX_PASSWORD_LENGTH,
  algorithm: 'scrypt',
  N: KDF_N,
  r: KDF_R,
  p: KDF_P,
  bytes: KDF_BYTES
});
