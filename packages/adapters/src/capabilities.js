function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export const AdapterPlatforms = Object.freeze(['tiktok','shopee','lazada','facebook','instagram','youtube','line']);
export const AdapterCapabilities = Object.freeze(['catalog.read','orders.read','affiliate.links.write','campaigns.write','content.publish','messages.send','analytics.read','webhooks.receive']);

export function createAdapterManifest({ platform, capabilities, secretMode = 'server-only', supportsIdempotency = false, supportsWebhooks = false }) {
  const normalizedPlatform = required(platform, 'platform').toLowerCase();
  if (!AdapterPlatforms.includes(normalizedPlatform)) throw new Error('unsupported adapter platform');
  const normalizedCapabilities = [...new Set((capabilities || []).map((capability) => required(capability, 'capability').toLowerCase()))].sort();
  for (const capability of normalizedCapabilities) {
    if (!AdapterCapabilities.includes(capability)) throw new Error(`unsupported adapter capability: ${capability}`);
  }
  if (secretMode !== 'server-only') throw new Error('adapter secrets must remain server-only');
  return Object.freeze({
    platform: normalizedPlatform,
    capabilities: Object.freeze(normalizedCapabilities),
    secretMode,
    supportsIdempotency: Boolean(supportsIdempotency),
    supportsWebhooks: Boolean(supportsWebhooks)
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
  tiktok: createAdapterManifest({ platform: 'tiktok', capabilities: ['catalog.read','orders.read','affiliate.links.write','campaigns.write','content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  shopee: createAdapterManifest({ platform: 'shopee', capabilities: ['catalog.read','orders.read','affiliate.links.write','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  lazada: createAdapterManifest({ platform: 'lazada', capabilities: ['catalog.read','orders.read','affiliate.links.write','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  facebook: createAdapterManifest({ platform: 'facebook', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  instagram: createAdapterManifest({ platform: 'instagram', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  youtube: createAdapterManifest({ platform: 'youtube', capabilities: ['content.publish','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true }),
  line: createAdapterManifest({ platform: 'line', capabilities: ['messages.send','analytics.read','webhooks.receive'], supportsIdempotency: true, supportsWebhooks: true })
});
