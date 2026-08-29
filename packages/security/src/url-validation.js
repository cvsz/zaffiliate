export const SSRF_BLOCKED = 'SSRF_BLOCKED';
const PRIVATE_HOST_SUFFIXES = new Set(['.local', '.internal', '.localhost']);

function failClosed(reason) {
  const error = new TypeError(`url validation failed: ${reason}`);
  error.code = SSRF_BLOCKED;
  throw error;
}

function isPrivateIPv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map(Number);
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
  const [a, b] = nums;
  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 (Carrier-Grade NAT: 100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 198.18.0.0/15 (Benchmark)
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isPrivateHost(host) {
  let lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower === '::1' || lower === '0.0.0.0' || lower === '::') return true;
  // IPv6 Unique Local (fc00::/7) or Link-Local (fe80::/10)
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/i.test(lower)) return true;
  // IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 or ::ffff:7f00:1 / ::ffff:a00:1 etc.)
  if (lower.startsWith('::ffff:')) {
    const sub = lower.slice(7);
    if (isPrivateIPv4(sub)) return true;
    const hexParts = sub.split(':');
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0], 16);
      const low = parseInt(hexParts[1], 16);
      if (!Number.isNaN(high) && !Number.isNaN(low)) {
        const ip = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
        if (isPrivateIPv4(ip)) return true;
      }
    }
  }
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
