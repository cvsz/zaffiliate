function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const AdapterPlatforms = Object.freeze(['tiktok','shopee','lazada','facebook','instagram','youtube','line']);
export const AdapterCapabilities = Object.freeze(['catalog.read','orders.read','affiliate.links.write','campaigns.write','content.publish','messages.send','analytics.read','webhooks.receive']);

export function createAdapterManifest({ platform, capabilities, secretMode = 'server-only', supportsIdempotency = false, supportsWebhooks = false, restrictions = [], requiredDisclosures = [], rateLimits = {}, contentConstraints = {}, lastVerifiedAt = null }) {
  const normalizedPlatform = required(platform, 'platform').toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform)) throw new Error('unsupported adapter platform');
  const normalizedCapabilities = [...new Set((capabilities || []).map((capability) => required(capability, 'capability').toLowerCase()))].sort();
  for (const capability of normalizedCapabilities) {
    if (!AdapterCapabilities.includes(capability)) throw new Error(`unsupported adapter capability: ${capability}`);
  }
  if (secretMode !== 'server-only') throw new Error('adapter secrets must remain server-only');
  const normalizedRestrictions = [...new Set((restrictions || []).map((r) => String(r).trim()).filter(Boolean))].sort();
  const normalizedDisclosures = [...new Set((requiredDisclosures || []).map((r) => String(r).trim()).filter(Boolean))].sort();
  if (rateLimits != null && typeof rateLimits !== 'object') throw new Error('rateLimits must be an object');
  if (contentConstraints != null && typeof contentConstraints !== 'object') throw new Error('contentConstraints must be an object');
  if (lastVerifiedAt != null) {
    const d = new Date(lastVerifiedAt);
    if (Number.isNaN(d.getTime())) throw new Error('lastVerifiedAt must be a valid timestamp');
  }
  return Object.freeze({
    platform: normalizedPlatform,
    capabilities: Object.freeze(normalizedCapabilities),
    secretMode,
    supportsIdempotency: Boolean(supportsIdempotency),
    supportsWebhooks: Boolean(supportsWebhooks),
    restrictions: Object.freeze(normalizedRestrictions),
    requiredDisclosures: Object.freeze(normalizedDisclosures),
    rateLimits: Object.freeze({ ...(rateLimits ?? {}) }),
    contentConstraints: Object.freeze({ ...(contentConstraints ?? {}) }),
    lastVerifiedAt: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null
  });
}

export function classifyAdapterOperation({ manifest, capability }) {
  const normalized = required(capability, 'capability').toLowerCase();
  if (!manifest.capabilities.includes(normalized)) return Object.freeze({ allowed: false, reason: 'capability_not_supported', mutating: false, requiresApproval: false });
  const mutating = normalized.endsWith('.write') || normalized === 'content.publish' || normalized === 'messages.send';
  return Object.freeze({
    allowed: true,
    reason: 'capability_supported',
    mutating,
    requiresApproval: mutating,
    requiresIdempotency: mutating && manifest.supportsIdempotency
  });
}

export function normalizeAdapterError({ platform, status = 0, code = null, message = 'adapter request failed', requestId = null }) {
  const httpStatus = Number(status || 0);
  return Object.freeze({
    platform: required(platform, 'platform').toLowerCase(),
    code: code == null ? null : String(code),
    message: String(message),
    requestId: requestId == null ? null : String(requestId),
    httpStatus,
    retryable: httpStatus === 408 || httpStatus === 429 || httpStatus >= 500
  });
}

export const CanonicalAdapterManifests = Object.freeze({
  tiktok: createAdapterManifest({ platform: 'tiktok', capabilities: ['catalog.read','orders.read','affiliate.links.write','campaigns.write','content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['affiliate product must be enabled on Shop Partner app'], requiredDisclosures: ['#Sponsored'], rateLimits: { defaultRps: 5, burst: 20 }, contentConstraints: { maxCaptionLength: 2200 }, lastVerifiedAt: '2026-08-30T00:00:00Z' }),
  shopee: createAdapterManifest({ platform: 'shopee', capabilities: ['catalog.read','orders.read','affiliate.links.write','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['sandbox credentials required'], requiredDisclosures: ['#Affiliate'], rateLimits: { defaultRps: 5 }, contentConstraints: {}, lastVerifiedAt: '2026-08-24T00:00:00Z' }),
  lazada: createAdapterManifest({ platform: 'lazada', capabilities: ['catalog.read','orders.read','affiliate.links.write','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: [], requiredDisclosures: [], rateLimits: { defaultRps: 5 }, contentConstraints: {}, lastVerifiedAt: '2026-08-24T00:00:00Z' }),
  facebook: createAdapterManifest({ platform: 'facebook', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['manual publishing boundary only'], requiredDisclosures: ['#Ad'], rateLimits: {}, contentConstraints: { maxVideoSeconds: 600 }, lastVerifiedAt: null }),
  instagram: createAdapterManifest({ platform: 'instagram', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['manual boundary'], requiredDisclosures: ['#Ad'], rateLimits: {}, contentConstraints: {}, lastVerifiedAt: null }),
  youtube: createAdapterManifest({ platform: 'youtube', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['manual boundary'], requiredDisclosures: ['#Ad'], rateLimits: {}, contentConstraints: {}, lastVerifiedAt: null }),
  line: createAdapterManifest({ platform: 'line', capabilities: ['messages.send','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true, restrictions: ['consent required'], requiredDisclosures: [], rateLimits: {}, contentConstraints: {}, lastVerifiedAt: null })
});
