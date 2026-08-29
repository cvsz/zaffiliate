const DEFAULT_DENYLIST = Object.freeze([
  'password',
  'secret',
  'token',
  'authorization',
  'apiKey',
  'api_key',
  'cookie',
  'set-cookie',
  'privateKey',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'ADMIN_BOOTSTRAP_KEY'
]);

const BASE_DENIED_KEYS = new Set(DEFAULT_DENYLIST.map((key) => key.toLowerCase()));

const SCRUBBERS = [
  { pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, replacement: '[REDACTED]' },
  { pattern: /bearer\s+[^\s",;)\]}]+/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}/g, replacement: '[REDACTED]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED]' },
  {
    pattern: /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|https?):\/\/([^\s:@/"']+):([^\s@/"']+)@/gi,
    replacement: '$1://$2:[REDACTED]@'
  }
];

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function isDeniedKey(key, denied) {
  return denied.has(String(key).toLowerCase());
}

function scrubString(value) {
  let output = value;
  for (const scrubber of SCRUBBERS) output = output.replace(scrubber.pattern, scrubber.replacement);
  return output;
}

export function createRedactor({ extraKeys = [], now = null } = {}) {
  if (!Array.isArray(extraKeys)) throw new TypeError('extraKeys must be an array of strings');
  const denied = new Set(BASE_DENIED_KEYS);
  for (const key of extraKeys) {
    if (typeof key !== 'string' || !key.trim()) throw new TypeError('extraKeys must be an array of non-empty strings');
    denied.add(key.toLowerCase());
  }
  const timestamp = typeof now === 'function' ? now : () => new Date().toISOString();

  function transform(value, seen) {
    if (typeof value === 'string') return scrubString(value);
    if (value === null || typeof value !== 'object') return value === undefined ? null : value;
    if (seen.has(value)) return null;
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return deepFreeze(value.map((item) => transform(item, seen)));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isDeniedKey(key, denied) ? '[REDACTED]' : transform(item, seen);
    }
    return deepFreeze(out);
  }

  function redact(obj) {
    if (obj === null) return null;
    if (typeof obj !== 'object' || Array.isArray(obj)) throw new TypeError('redact expects an object');
    return transform(obj, new WeakSet());
  }

  function redactLogLine(level, msg, fields = null) {
    if (typeof level !== 'string' || !level.trim()) throw new TypeError('level must be a non-empty string');
    if (typeof msg !== 'string' || !msg.trim()) throw new TypeError('msg must be a non-empty string');
    const line = { ts: timestamp(), level, msg: scrubString(msg) };
    if (fields == null) return deepFreeze(line);
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('fields must be an object');
    return deepFreeze({ ...line, ...transform(fields, new WeakSet()) });
  }

  return Object.freeze({ redact, redactLogLine });
}

export function redactLogLine(level, msg, fields = null) {
  return createRedactor().redactLogLine(level, msg, fields);
}
