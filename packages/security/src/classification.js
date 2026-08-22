export const SECRET_CLASSES = Object.freeze({
  WEBHOOK_VERIFY_TOKEN: 'webhook_verify_token',
  API_TOKEN: 'api_token',
  OAUTH_CLIENT_SECRET: 'oauth_client_secret',
  SIGNING_KEY: 'signing_key',
  DATABASE_URL: 'database_url',
  SESSION_SECRET: 'session_secret',
  GENERIC_CREDENTIAL: 'generic_credential'
});

export const SEVERITIES = Object.freeze({ CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium' });

export const HANDLING_MODES = Object.freeze({
  SECRET_MANAGER: 'secret-manager',
  NEVER_STORE: 'never-store',
  ROTATE: 'rotate'
});

export const POLICY_RULES = Object.freeze({
  webhook_verify_token: Object.freeze({ severity: SEVERITIES.HIGH, handling: HANDLING_MODES.SECRET_MANAGER, rule: 'store in the server-side secret manager and pass around only ref:<path>' }),
  api_token: Object.freeze({ severity: SEVERITIES.CRITICAL, handling: HANDLING_MODES.NEVER_STORE, rule: 'provider-issued key: never persist or log the material; inject at runtime through a secret-manager reference and rotate on exposure' }),
  oauth_client_secret: Object.freeze({ severity: SEVERITIES.CRITICAL, handling: HANDLING_MODES.SECRET_MANAGER, rule: 'store in the server-side secret manager; rotate whenever collaborators change' }),
  signing_key: Object.freeze({ severity: SEVERITIES.CRITICAL, handling: HANDLING_MODES.SECRET_MANAGER, rule: 'generate and store inside a KMS-backed secret manager; rotate on a fixed schedule' }),
  database_url: Object.freeze({ severity: SEVERITIES.HIGH, handling: HANDLING_MODES.SECRET_MANAGER, rule: 'keep the full DSN in the secret manager; expand refs at boot only' }),
  session_secret: Object.freeze({ severity: SEVERITIES.HIGH, handling: HANDLING_MODES.SECRET_MANAGER, rule: 'store in the server-side secret manager; rotation invalidates live sessions' }),
  generic_credential: Object.freeze({ severity: SEVERITIES.MEDIUM, handling: HANDLING_MODES.ROTATE, rule: 'unrecognized credential material: rotate the source credential and re-classify with explicit hints' })
});

const CONNECTION_URL_PATTERN = /^(?:postgres|postgresql|mysql|mariadb|mongodb|mongodb\+srv|redis|rediss|amqp|amqps|mssql):\/\//i;
const PEM_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const HEX_40_PATTERN = /^[a-f0-9]{40}$/i;
const AWS_ACCESS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/;

function normalizeHints(hints) {
  if (hints == null) return [];
  const list = typeof hints === 'string' ? [hints] : Array.isArray(hints) ? hints : null;
  if (!list) throw new TypeError('hints must be a string or an array of strings');
  const normalized = [];
  for (const hint of list) {
    if (typeof hint !== 'string') throw new TypeError('hints must be a string or an array of strings');
    const lowered = hint.toLowerCase();
    normalized.push(lowered);
    for (const token of lowered.split(/[^a-z0-9]+/)) {
      if (token) normalized.push(token);
    }
  }
  return normalized;
}

function hintMatches(normalizedHints, needle) {
  return normalizedHints.some((hint) => hint.includes(needle));
}

function looksSecretLike(value) {
  return value.replace(/[^A-Za-z0-9]/g, '').length >= 8;
}

function detectClass(value, normalizedHints) {
  if (PEM_KEY_PATTERN.test(value)) return SECRET_CLASSES.SIGNING_KEY;
  if (CONNECTION_URL_PATTERN.test(value)) return SECRET_CLASSES.DATABASE_URL;
  if (value.startsWith('sk-')) return SECRET_CLASSES.API_TOKEN;
  if (AWS_ACCESS_KEY_PATTERN.test(value)) return SECRET_CLASSES.API_TOKEN;
  if (value.startsWith('whsec_')) return SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN;
  if (HEX_40_PATTERN.test(value) && hintMatches(normalizedHints, 'webhook')) return SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN;
  if (hintMatches(normalizedHints, 'webhook') && looksSecretLike(value)) return SECRET_CLASSES.WEBHOOK_VERIFY_TOKEN;
  if ((hintMatches(normalizedHints, 'oauth') || hintMatches(normalizedHints, 'client_secret') || hintMatches(normalizedHints, 'clientsecret')) && looksSecretLike(value)) return SECRET_CLASSES.OAUTH_CLIENT_SECRET;
  if (hintMatches(normalizedHints, 'session') && looksSecretLike(value)) return SECRET_CLASSES.SESSION_SECRET;
  if ((hintMatches(normalizedHints, 'signing') || hintMatches(normalizedHints, 'jwt')) && looksSecretLike(value)) return SECRET_CLASSES.SIGNING_KEY;
  return SECRET_CLASSES.GENERIC_CREDENTIAL;
}

export function classifySecretMaterial(value, hints = []) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('secret material must be a non-empty string');
  const klass = detectClass(value, normalizeHints(hints));
  const rule = POLICY_RULES[klass];
  return Object.freeze({ class: klass, severity: rule.severity, handling: rule.handling });
}

export function classifyAndAssert(value, expectedClass, hints = []) {
  if (!Object.values(SECRET_CLASSES).includes(expectedClass)) throw new TypeError(`unknown expected secret class: ${expectedClass}`);
  const result = classifySecretMaterial(value, hints);
  if (result.class !== expectedClass) {
    const error = new Error(`classification mismatch: expected ${expectedClass} but got ${result.class}`);
    error.code = 'CLASSIFICATION_MISMATCH';
    error.result = result;
    throw error;
  }
  return result;
}
