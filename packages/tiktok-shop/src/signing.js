import { createHmac, timingSafeEqual } from 'node:crypto';

function requireSecret(secret) {
  const value = String(secret || '');
  if (!value) throw new Error('app secret is required');
  return value;
}

export function buildTikTokSigningPayload({ path, query = {}, body = '', method = 'GET', contentType = 'application/json', appSecret }) {
  const secret = requireSecret(appSecret);
  const pathname = String(path || '').trim();
  if (!pathname.startsWith('/')) throw new Error('path must start with /');

  const entries = Object.entries(query)
    .filter(([key, value]) => !['sign', 'access_token', 'x-tts-access-token'].includes(key) && !Array.isArray(value))
    .sort(([a], [b]) => a.localeCompare(b));

  let canonical = pathname;
  for (const [key, value] of entries) canonical += `${key}${value}`;

  const upperMethod = String(method || 'GET').toUpperCase();
  const multipart = String(contentType || '').toLowerCase().includes('multipart/form-data');
  if (upperMethod !== 'GET' && !multipart) canonical += String(body ?? '');

  return `${secret}${canonical}${secret}`;
}

export function signTikTokRequest(input) {
  const secret = requireSecret(input?.appSecret);
  const payload = buildTikTokSigningPayload(input);
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function timingSafeHexEqual(expectedHex, actualHex) {
  const a = Buffer.from(String(expectedHex || ''), 'hex');
  const b = Buffer.from(String(actualHex || ''), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
