import { classifySecretMaterial } from './classification.js';

const REF_PREFIX = 'ref:';
const REF_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertValidSecretRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(REF_PREFIX)) {
    const error = new Error("secret material must be referenced as 'ref:<path>'; raw values are rejected");
    error.code = 'SECRET_REF_REQUIRED';
    throw error;
  }
  const path = ref.slice(REF_PREFIX.length).trim();
  if (!path || !REF_PATH_PATTERN.test(path) || path.includes('//')) {
    const error = new Error(`malformed secret ref: expected ${REF_PREFIX}<path> with a safe relative path`);
    error.code = 'SECRET_REF_INVALID';
    throw error;
  }
  return path;
}

function requireSecretValue(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('secret value must be a non-empty string');
}

function notFound(path) {
  const error = new Error(`secret not found for ref: ${REF_PREFIX}${path}`);
  error.code = 'SECRET_NOT_FOUND';
  return error;
}

export function createInMemorySecretBackend() {
  const store = new Map();
  return Object.freeze({
    get(ref) {
      if (typeof ref !== 'string') throw new TypeError('ref must be a string');
      return store.has(ref) ? store.get(ref) : null;
    },
    put(ref, value) {
      assertValidSecretRef(ref);
      requireSecretValue(value);
      store.set(ref, value);
      return Object.freeze({ ref, stored: true });
    }
  });
}

function refHints(path) {
  return path.split(/[^A-Za-z0-9]+/).filter(Boolean).join(' ');
}

export function createSecretManager({ backend } = {}) {
  if (!backend || typeof backend !== 'object' || typeof backend.get !== 'function' || typeof backend.put !== 'function') {
    throw new TypeError('backend implementing { get(ref), put(ref, value) } is required');
  }
  function currentValue(path) {
    const value = backend.get(REF_PREFIX + path);
    if (typeof value !== 'string' || !value) throw notFound(path);
    return value;
  }
  return Object.freeze({
    put(ref, value) {
      const path = assertValidSecretRef(ref);
      requireSecretValue(value);
      backend.put(REF_PREFIX + path, value);
      return Object.freeze({ ref: REF_PREFIX + path, stored: true });
    },
    resolve(ref) {
      const path = assertValidSecretRef(ref);
      const value = currentValue(path);
      return Object.freeze({ ref: REF_PREFIX + path, value, classifiedAs: classifySecretMaterial(value, refHints(path)) });
    },
    classify(ref) {
      const path = assertValidSecretRef(ref);
      return classifySecretMaterial(currentValue(path), refHints(path));
    }
  });
}

export function resolveSecret(manager, ref) {
  if (!manager || typeof manager.resolve !== 'function') throw new TypeError('secret manager exposing resolve(ref) is required');
  return manager.resolve(ref);
}

export function assertServerSideOnly(secretRef, context = null) {
  if (typeof secretRef !== 'string' || !secretRef.startsWith(REF_PREFIX)) {
    const error = new Error('server-side-only violation: secrets may only be handled as ref:<path> references');
    error.code = 'SERVER_SIDE_ONLY';
    error.context = context;
    throw error;
  }
  return true;
}
