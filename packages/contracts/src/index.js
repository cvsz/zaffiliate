export const Platforms = Object.freeze({
  TIKTOK: 'tiktok',
  SHOPEE: 'shopee',
  LAZADA: 'lazada',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  YOUTUBE: 'youtube',
  LINE: 'line'
});

export function requireTenantContext(input) {
  if (!input || typeof input !== 'object') throw new TypeError('context is required');
  const tenantId = String(input.tenantId || '').trim();
  const actorId = String(input.actorId || '').trim();
  if (!tenantId) throw new Error('tenantId is required');
  if (!actorId) throw new Error('actorId is required');
  return Object.freeze({ tenantId, actorId });
}

export function normalizeAffiliateLink(input) {
  if (!input || typeof input !== 'object') throw new TypeError('affiliate link input is required');
  const platform = String(input.platform || '').toLowerCase();
  if (!Object.values(Platforms).includes(platform)) throw new Error('unsupported platform');
  const url = new URL(String(input.url || ''));
  if (url.protocol !== 'https:') throw new Error('affiliate URL must use HTTPS');
  return Object.freeze({
    platform,
    url: url.toString(),
    externalProductId: String(input.externalProductId || '').trim(),
    subId: input.subId == null ? null : String(input.subId).trim()
  });
}
