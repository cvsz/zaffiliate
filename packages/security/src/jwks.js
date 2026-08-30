import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export function createJwksClient({ jwksUri, fetchImpl = null, cacheTtlMs = 10 * 60 * 1000, clock = () => Date.now() } = {}) {
  if (!jwksUri) throw new Error('jwksUri is required');
  const doFetch = fetchImpl ?? ((uri) => fetch(uri).then(async (response) => {
    if (!response.ok) throw new Error(`jwks fetch failed with ${response.status}`);
    return response.json();
  }));

  let cache = null;
  let cachedAt = 0;
  let refreshInFlight = null;
  let forcedGeneration = null;

  async function loadKeys({ force = false } = {}) {
    const fresh = cache && clock() - cachedAt < cacheTtlMs;
    if (cache && !force && fresh) return cache;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const response = await doFetch(jwksUri);
      const document = (response && typeof response.json === 'function') ? await response.json() : response;
      if (!document || !Array.isArray(document.keys)) throw new Error('invalid JWKS document');
      cache = document.keys;
      cachedAt = clock();
      return cache;
    })();
    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  async function getKey(kid, { allowRefresh = true } = {}) {
    let keys = await loadKeys();
    const find = (candidates) => candidates.find((candidate) => candidate.kid === kid && (candidate.use ?? 'sig') === 'sig') ?? null;
    let jwk = find(keys);
    if (!jwk && allowRefresh && forcedGeneration !== cachedAt) {
      forcedGeneration = cachedAt;
      keys = await loadKeys({ force: true });
      jwk = find(keys);
    }
    return jwk;
  }

  return Object.freeze({
    getKey,
    clearCache: () => { cache = null; }
  });
}

const SUPPORTED_ALGORITHMS = new Set(['RS256']);

function b64urlJson(section) {
  try {
    return JSON.parse(Buffer.from(section, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function timingSafeEqualStrings(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyJwt({ token, jwksClient, issuer, audience, nonce = null, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const fail = (reason) => ({ valid: false, reason });
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return fail('malformed_token');

  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!header || !claims) return fail('malformed_token');
  if (!SUPPORTED_ALGORITHMS.has(header.alg)) return fail(`unsupported_algorithm_${header.alg}`);

  const signature = Buffer.from(parts[2], 'base64url');
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`);

  return Promise.resolve(jwksClient.getKey(header.kid)).then((jwk) => {
    if (!jwk) return fail('unknown_kid');
    let keyMaterial;
    try {
      keyMaterial = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      return fail('invalid_jwk');
    }
    const signatureValid = cryptoVerify('RSA-SHA256', signed, keyMaterial, signature);
    if (!signatureValid) return fail('signature_verification_failed');

    if (typeof claims.exp === 'number' && claims.exp < nowSeconds) return fail('token_expired');
    if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds) return fail('token_not_yet_valid');
    if (issuer != null && !timingSafeEqualStrings(String(claims.iss ?? ''), String(issuer))) return fail('issuer_mismatch');
    if (audience != null) {
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.some((entry) => timingSafeEqualStrings(String(entry ?? ''), String(audience)))) {
        return fail('audience_mismatch');
      }
    }
    if (nonce != null && !timingSafeEqualStrings(String(claims.nonce ?? ''), String(nonce))) return fail('nonce_mismatch');

    return { valid: true, reason: 'verified', claims: Object.freeze({ ...claims }), header: Object.freeze({ ...header }) };
  });
}
