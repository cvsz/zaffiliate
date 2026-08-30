import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertMediaContentMatches, isAllowedMediaMime, sniffMediaMime } from './content-validation.js';

export { assertMediaContentMatches, isAllowedMediaMime, sniffMediaMime } from './content-validation.js';

const EXTENSION_BY_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm']
]);

export function validateMediaUpload({ filename, declaredMime, sizeBytes, body = null, organizationId = 'org-default', maxBytes = 25 * 1024 * 1024 }) {
  const issues = [];
  const declared = String(declaredMime ?? '').toLowerCase().trim();
  const size = Number(sizeBytes);

  if (!isAllowedMediaMime(declared)) issues.push(`mime type not allowed: ${declared || '(none)'}`);
  if (!Number.isFinite(size) || size <= 0) issues.push('size must be a positive number');
  else if (size > maxBytes) issues.push(`file exceeds maximum size of ${maxBytes} bytes`);

  const base = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  if (!base || base.startsWith('.')) issues.push('filename must have a visible non-hidden basename');
  if (String(filename ?? '').includes(String.fromCharCode(0))) issues.push('filename contains null bytes');

  if (body != null) {
    if (!Buffer.isBuffer(body)) issues.push('body must be a Buffer when provided');
    else if (body.length !== size) issues.push('declared size does not match body length');
    else if (isAllowedMediaMime(declared)) {
      try {
        assertMediaContentMatches(body, declared);
      } catch (error) {
        issues.push(error.code === 'MEDIA_MIME_MISMATCH' ? 'media bytes do not match declared mime' : 'media content validation failed');
      }
    }
  }

  if (issues.length > 0) {
    return Object.freeze({ allowed: false, issues: Object.freeze(issues), objectKey: null });
  }

  const tenant = String(organizationId ?? '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(tenant) || tenant === '.' || tenant === '..') {
    return Object.freeze({ allowed: false, issues: Object.freeze(['organizationId is invalid for an object key']), objectKey: null });
  }

  const extension = EXTENSION_BY_MIME.get(declared);
  const observedAt = new Date();
  const objectKey = `tenants/${tenant}/${observedAt.getUTCFullYear()}/${String(observedAt.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID().replace(/-/g, '')}.${extension}`;

  return Object.freeze({ allowed: true, issues: Object.freeze([]), objectKey });
}

const KEY_PATTERN = /^tenants\/[A-Za-z0-9._-]+\/\d{4}\/\d{2}\/[a-f0-9-]+\.[a-z0-9]{2,5}$/;
const MAX_OBJECT_KEY_LENGTH = 512;

export function assertValidObjectKey(key) {
  const normalized = String(key ?? '');
  const segments = normalized.split('/');
  const invalid =
    !normalized ||
    normalized.length > MAX_OBJECT_KEY_LENGTH ||
    normalized.includes(String.fromCharCode(0)) ||
    normalized.includes('\\') ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    /%2f|%5c/i.test(normalized) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    !KEY_PATTERN.test(normalized);
  if (invalid) {
    throw new Error(`invalid object key: keys must match ${KEY_PATTERN.source} and contain no traversal or encoded separators`);
  }
  return normalized;
}

export function createLocalDriver({ rootDir }) {
  if (!rootDir) throw new Error('rootDir is required');
  const root = resolve(rootDir);

  function safePath(key) {
    const normalized = assertValidObjectKey(key);
    const resolved = resolve(root, normalized);
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error('invalid object key: escapes storage root');
    return resolved;
  }

  async function put(key, body, contentType) {
    if (!Buffer.isBuffer(body)) throw new TypeError('body must be a Buffer');
    const target = safePath(key);
    const validated = assertMediaContentMatches(body, contentType);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { stored: true, key, bytes: body.length, contentType: validated.detectedMime };
  }

  async function get(key) {
    const target = safePath(key);
    const body = await readFile(target);
    return { body, key };
  }

  return Object.freeze({ put, get });
}

export function signObjectUrl(objectKey, { secret, expiresInSeconds = 300, now = Date.now(), baseUrl = '/storage' } = {}) {
  const key = assertValidObjectKey(decodeURIComponent(objectKey));
  const ttlSeconds = Number(expiresInSeconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error('expiresInSeconds must be a positive number');
  const currentTime = Number(now);
  if (!Number.isFinite(currentTime) || currentTime <= 0) throw new Error('now must be a positive epoch millisecond value');
  const encodedKey = encodeURIComponent(key);
  const expiresAt = currentTime + ttlSeconds * 1000;
  const signature = createHmac('sha256', requireSecret(secret)).update(`${key}:${expiresAt}`).digest('hex').slice(0, 32);
  return `${baseUrl}/${encodedKey}?expires=${expiresAt}&signature=${signature}`;
}

export function verifyObjectUrlSignature(url, { secret, now = Date.now() } = {}) {
  try {
    const parsed = new URL(url, 'https://internal.invalid');
    if (!parsed.pathname.startsWith('/storage/')) return { valid: false, reason: 'invalid storage path' };
    const key = assertValidObjectKey(decodeURIComponent(parsed.pathname.slice('/storage/'.length)));
    const expiresAt = Number(parsed.searchParams.get('expires'));
    const currentTime = Number(now);
    const signature = parsed.searchParams.get('signature') ?? '';
    if (!Number.isFinite(expiresAt)) return { valid: false, reason: 'missing expiry' };
    if (!Number.isFinite(currentTime) || currentTime <= 0) return { valid: false, reason: 'invalid current time' };
    if (expiresAt < currentTime) return { valid: false, reason: 'expired' };
    if (!/^[a-f0-9]{32}$/.test(signature)) return { valid: false, reason: 'signature mismatch' };
    const expected = createHmac('sha256', requireSecret(secret)).update(`${key}:${expiresAt}`).digest('hex').slice(0, 32);
    const expectedBytes = Buffer.from(expected, 'hex');
    const signatureBytes = Buffer.from(signature, 'hex');
    if (expectedBytes.length !== signatureBytes.length || !timingSafeEqual(expectedBytes, signatureBytes)) {
      return { valid: false, reason: 'signature mismatch' };
    }
    return { valid: true, objectKey: key };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

function requireSecret(value) {
  const text = String(value ?? '');
  if (!text) throw new Error('signing secret is required');
  return text;
}
