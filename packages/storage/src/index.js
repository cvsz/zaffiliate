import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm'
]);

const EXTENSION_BY_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['video/mp4', 'mp4'],
  ['video/quicktime', 'mov'],
  ['video/webm', 'webm']
]);

export function validateMediaUpload({ filename, declaredMime, sizeBytes, organizationId = 'org-default', maxBytes = 25 * 1024 * 1024 }) {
  const issues = [];
  const declared = String(declaredMime ?? '').toLowerCase().trim();
  const size = Number(sizeBytes);

  if (!ALLOWED_MIME.has(declared)) issues.push(`mime type not allowed: ${declared || '(none)'}`);
  if (!Number.isFinite(size) || size <= 0) issues.push('size must be a positive number');
  else if (size > maxBytes) issues.push(`file exceeds maximum size of ${maxBytes} bytes`);

  const base = String(filename ?? '').split(/[\\/]/).pop() ?? '';
  if (!base || base.startsWith('.')) issues.push('filename must have a visible non-hidden basename');
  if (/\0/.test(String(filename))) issues.push('filename contains null bytes');

  if (issues.length > 0) {
    return Object.freeze({ allowed: false, issues: Object.freeze(issues), objectKey: null });
  }

  const extension = EXTENSION_BY_MIME.get(declared);
  const observedAt = new Date();
  const objectKey = `tenants/${String(organizationId).trim()}/${observedAt.getUTCFullYear()}/${String(observedAt.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID().replace(/-/g, '')}.${extension}`;

  return Object.freeze({ allowed: true, issues: Object.freeze([]), objectKey });
}

const KEY_PATTERN = /^tenants\/[A-Za-z0-9._-]+\/\d{4}\/\d{2}\/[a-f0-9-]+\.[a-z0-9]{2,5}$/;

export function assertValidObjectKey(key) {
  const normalized = String(key ?? '');
  if (!KEY_PATTERN.test(normalized) || normalized.includes('..') || normalized.includes('\\')) {
    throw new Error(`invalid object key: keys must match ${KEY_PATTERN.source}`);
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
    const target = safePath(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { stored: true, key, bytes: body.length, contentType };
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
  const encodedKey = encodeURIComponent(key);
  const expiresAt = now + expiresInSeconds * 1000;
  const signature = createHmac('sha256', secret).update(`${key}:${expiresAt}`).digest('hex').slice(0, 32);
  return `${baseUrl}/${encodedKey}?expires=${expiresAt}&signature=${signature}`;
}

export function verifyObjectUrlSignature(url, { secret, now = Date.now() } = {}) {
  try {
    const parsed = new URL(url, 'https://internal.invalid');
    const key = decodeURIComponent(parsed.pathname.replace(/^\/storage\//, ''));
    const expiresAt = Number(parsed.searchParams.get('expires'));
    const signature = parsed.searchParams.get('signature') ?? '';
    if (!Number.isFinite(expiresAt)) return { valid: false, reason: 'missing expiry' };
    if (expiresAt < now) return { valid: false, reason: 'expired' };
    const expected = createHmac('sha256', requireSecret(secret)).update(`${key}:${expiresAt}`).digest('hex').slice(0, 32);
    if (expected.length !== signature.length || expected !== signature) return { valid: false, reason: 'signature mismatch' };
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
