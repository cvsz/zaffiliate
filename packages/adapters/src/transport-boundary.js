const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'x-api-key']);
const SENSITIVE_BODY_KEYS = new Set(['secret', 'token', 'password', 'authorization']);

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return Object.freeze(out);
}

function checkSensitiveBodyKeys(body) {
  if (body == null) return;
  if (typeof body !== 'object' || Array.isArray(body)) return;
  for (const key of Object.keys(body)) {
    if (SENSITIVE_BODY_KEYS.has(String(key).toLowerCase())) {
      const error = new Error(`request body contains sensitive top-level key: ${key}`);
      error.code = 'sensitive_body_blocked';
      throw error;
    }
  }
}

export function createTransportBoundary({ urlValidator } = {}) {
  if (!urlValidator || typeof urlValidator.validate !== 'function') {
    throw new TypeError('urlValidator exposing validate(url, context) is required');
  }

  return Object.freeze({
    request({ method, url, headers, body }) {
      if (typeof method !== 'string' || !method.trim()) throw new TypeError('method is required');
      if (typeof url !== 'string' || !url.trim()) throw new TypeError('url is required');

      urlValidator.validate(url, 'outbound_request');

      checkSensitiveBodyKeys(body);

      const safeHeaders = redactHeaders(headers);

      return Object.freeze({
        status: Number(200),
        headers: Object.freeze(safeHeaders),
        body: null
      });
    }
  });
}
