function requiredString(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const CommerceProviderCapabilities = Object.freeze([
  'PRODUCT_SEARCH',
  'PRODUCT_SYNC',
  'PRODUCT_DETAILS',
  'AFFILIATE_LINK',
  'COMMISSION_DATA',
  'ORDER_DATA',
  'WEBHOOKS',
  'PRICE_TRACKING',
  'STOCK_TRACKING'
]);

export class CommerceProviderError extends Error {
  constructor(message, { code = 'COMMERCE_PROVIDER_ERROR', providerCode = null, httpStatus = null, retryable = false } = {}) {
    super(message);
    this.name = 'CommerceProviderError';
    this.code = code;
    this.providerCode = providerCode;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function classifyCommerceError(status, providerCode, message = '') {
  const s = Number(status || 0);
  const code = String(providerCode || '').toLowerCase();
  const msg = String(message || '').toLowerCase();
  if (s === 429 || code.includes('rate_limit') || msg.includes('rate limit')) {
    return { category: 'RATE_LIMIT', retryable: true };
  }
  if (s === 401 || code.includes('unauthorized') || code.includes('auth')) {
    return { category: 'AUTHENTICATION', retryable: false };
  }
  if (s === 403 || code.includes('forbidden') || code.includes('permission')) {
    return { category: 'AUTHORIZATION', retryable: false };
  }
  if (s === 400 || code.includes('invalid') || code.includes('validation')) {
    return { category: 'VALIDATION', retryable: false };
  }
  if (s >= 500 || s === 408 || code.includes('server_error') || code.includes('timeout')) {
    return { category: 'PROVIDER_UNAVAILABLE', retryable: true };
  }
  return { category: 'PERMANENT', retryable: false };
}

export function createCommerceProvider({ provider, manifest, transport, urlValidator } = {}) {
  requiredString(provider, 'provider');
  if (typeof transport !== 'function') throw new TypeError('transport function is required');
  const normalizedProvider = String(provider).toLowerCase();
  const source = String(urlValidator ?? 'default').toLowerCase();

  const baseUrl = manifest?.baseUrl ?? null;
  const rateLimits = manifest?.rateLimits ?? { defaultRps: 5, burst: 20 };
  let requestCount = 0;
  let windowStart = Date.now();

  function checkRateLimit() {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      requestCount = 0;
    }
    requestCount++;
    if (requestCount > rateLimits.burst) {
      const delay = Math.max(0, 1000 / (rateLimits.defaultRps || 5) - (now - windowStart) / Math.max(requestCount, 1));
      if (delay > 0) return delay;
    }
    return 0;
  }

  async function callApi(endpoint, { method = 'POST', accessToken, body = null, retries = 3 } = {}) {
    const delay = checkRateLimit();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await transport({ url: endpoint, method, headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
        const status = Number(response?.status ?? 0);
        let payload = null;
        try { payload = typeof response?.json === 'function' ? await response.json() : JSON.parse(response?.text || '{}'); } catch { payload = null; }
        if (status >= 200 && status < 300) return Object.freeze({ status, payload });
        const classification = classifyCommerceError(status, payload?.code ?? payload?.error_code, payload?.message);
        const error = new CommerceProviderError(`commerce provider error (${status})`, { code: classification.category, providerCode: payload?.code ?? payload?.error_code, httpStatus: status, retryable: classification.retryable });
        if (!classification.retryable || attempt === retries) throw error;
        lastError = error;
        const backoff = Math.min(10_000, 250 * (2 ** attempt));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } catch (err) {
        if (err instanceof CommerceProviderError && !err.retryable) throw err;
        lastError = err;
        if (attempt === retries) throw err;
        const backoff = Math.min(10_000, 250 * (2 ** attempt));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw lastError;
  }

  return Object.freeze({
    provider: normalizedProvider,
    capabilities: manifest?.capabilities ?? [],
    secretMode: manifest?.secretMode ?? 'server-only',
    rateLimits,
    callApi,
    checkRateLimit,
    classifyCommerceError
  });
}
