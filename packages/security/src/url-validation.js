export const SSRF_BLOCKED = 'SSRF_BLOCKED';
export const PRIVATE_IPV4 = /^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/;
const PRIVATE_HOST_SUFFIXES = new Set(['.local', '.internal']);

function failClosed(reason) {
  const error = new TypeError(`url validation failed: ${reason}`);
  error.code = SSRF_BLOCKED;
  throw error;
}

function isPrivateIPv4(host) {
  if (!PRIVATE_IPV4.test(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4) return false;
  return parts.every((part) => part >= 0 && part <= 255);
}

function isPrivateHost(host) {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower === '::1') return true;
  if (isPrivateIPv4(lower)) return true;
  for (const suffix of PRIVATE_HOST_SUFFIXES) {
    if (lower === suffix.slice(1) || lower.endsWith(suffix)) return true;
  }
  return false;
}

function hostMatchesPattern(host, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host === pattern.slice(2) || host.endsWith(suffix);
  }
  return host === pattern;
}

export function createUrlValidator({ allowedHosts = [], allowedSchemes = ['https'], blockPrivateRanges = true } = {}) {
  if (!Array.isArray(allowedHosts)) throw new TypeError('allowedHosts must be an array');
  if (!Array.isArray(allowedSchemes) || allowedSchemes.length === 0) throw new TypeError('allowedSchemes must be a non-empty array');
  if (typeof blockPrivateRanges !== 'boolean') throw new TypeError('blockPrivateRanges must be a boolean');

  const normalizedSchemes = new Set(allowedSchemes.map((s) => String(s).toLowerCase()));
  const normalizedHosts = allowedHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean);

  return Object.freeze({
    validate(input, context = 'unknown') {
      if (typeof input !== 'string') throw new TypeError(`url must be a string, got ${typeof input}`);
      const trimmed = input.trim();
      if (!trimmed) throw new TypeError('url must be a non-empty string');

      let parsed;
      try {
        parsed = new URL(trimmed);
      } catch {
        throw new TypeError(`url could not be parsed: ${trimmed}`);
      }

      const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
      if (!normalizedSchemes.has(protocol)) {
        const error = new TypeError(`scheme "${protocol}" is not allowed`);
        error.code = 'SCHEME_BLOCKED';
        throw error;
      }

      const host = parsed.hostname.toLowerCase();

      if (blockPrivateRanges && isPrivateHost(host)) {
        const error = new TypeError(`private host blocked: ${host}`);
        error.code = SSRF_BLOCKED;
        throw error;
      }

      if (normalizedHosts.length > 0 && !normalizedHosts.some((pattern) => hostMatchesPattern(host, pattern))) {
        const error = new TypeError(`host "${host}" is not in allowedHosts`);
        error.code = 'HOST_NOT_ALLOWED';
        throw error;
      }

      return Object.freeze({ allowed: true, host, protocol });
    }
  });
}
