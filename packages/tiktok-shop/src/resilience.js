const RESILIENCE_CODES = Object.freeze(['timeout', 'circuit_open', 'operation_failed']);

function toPositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function toNonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

export function classifyRetry(error) {
  return Boolean(error && typeof error === 'object' && error.retryable === true);
}

function isNormalizedResilienceError(error) {
  return error instanceof Error && RESILIENCE_CODES.includes(error.code);
}

function createResilienceError({ code, message, retryable, httpStatus = 0, cause = null }) {
  const error = new Error(String(message));
  error.code = code;
  error.retryable = Boolean(retryable);
  error.httpStatus = Number(httpStatus || 0);
  if (cause) error.cause = cause;
  return Object.freeze(error);
}

function normalizeFailure(error) {
  if (isNormalizedResilienceError(error)) return error;
  const source = error && typeof error === 'object' ? error : {};
  return createResilienceError({
    code: 'operation_failed',
    message: String(source.message || 'operation failed'),
    retryable: classifyRetry(source),
    httpStatus: Number(source.httpStatus || 0),
    cause: error ?? null
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createResilientInvoker(config = {}) {
  const options = config && typeof config === 'object' ? config : {};
  const timeoutMs = toPositiveNumber(options.timeoutMs ?? 10000, 'timeoutMs');
  const maxRetries = toNonNegativeInteger(options.maxRetries ?? 3, 'maxRetries');
  const baseDelayMs = toPositiveNumber(options.baseDelayMs ?? 100, 'baseDelayMs');
  const maxDelayMs = toPositiveNumber(options.maxDelayMs ?? 5000, 'maxDelayMs');
  const breakerThreshold = toNonNegativeInteger(options.breakerThreshold ?? 5, 'breakerThreshold');
  const breakerResetMs = toPositiveNumber(options.breakerResetMs ?? 30000, 'breakerResetMs');
  if (maxDelayMs < baseDelayMs) throw new Error('maxDelayMs must be greater than or equal to baseDelayMs');
  if (breakerThreshold < 1) throw new Error('breakerThreshold must be at least 1');

  let state = 'closed';
  let consecutiveFailures = 0;
  let openedAtMs = 0;
  let probeInFlight = false;

  function allowInvocation(nowMs) {
    if (state === 'open') {
      if (nowMs - openedAtMs < breakerResetMs) return false;
      state = 'half_open';
      probeInFlight = false;
    }
    if (state === 'half_open') {
      if (probeInFlight) return false;
      probeInFlight = true;
    }
    return true;
  }

  function recordSuccess() {
    consecutiveFailures = 0;
    probeInFlight = false;
    state = 'closed';
  }

  function recordFailure(nowMs) {
    probeInFlight = false;
    if (state === 'half_open') {
      state = 'open';
      openedAtMs = nowMs;
      consecutiveFailures = Math.max(consecutiveFailures + 1, breakerThreshold);
      return;
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= breakerThreshold) {
      state = 'open';
      openedAtMs = nowMs;
    }
  }

  function computeBackoffMs(attempt) {
    const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
    return Math.min(maxDelayMs, exponential * (0.5 + Math.random() * 0.5));
  }

  async function attemptOnce(operation) {
    const controller = new AbortController();
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(createResilienceError({ code: 'timeout', message: `operation timed out after ${timeoutMs}ms`, retryable: true }));
          }, timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function invoke(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    if (!allowInvocation(Date.now())) {
      throw createResilienceError({ code: 'circuit_open', message: 'circuit breaker is open', retryable: true });
    }
    let attempt = 0;
    for (;;) {
      try {
        const result = await attemptOnce(operation);
        recordSuccess();
        return result;
      } catch (error) {
        if (!classifyRetry(error) || attempt >= maxRetries) {
          if (!(isNormalizedResilienceError(error) && error.code === 'circuit_open')) recordFailure(Date.now());
          throw normalizeFailure(error);
        }
        await sleep(computeBackoffMs(attempt));
        attempt += 1;
      }
    }
  }

  return Object.freeze({ invoke });
}
