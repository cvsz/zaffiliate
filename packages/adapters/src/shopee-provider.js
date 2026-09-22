import { createShopeeClient } from './shopee.js';
import { createCommerceProvider, CommerceProviderError } from './commerce-provider.js';

export function createShopeeProvider({ baseUrl, partnerId, partnerKey, transport, urlValidator, clock = Date.now } = {}) {
  const client = createShopeeClient({ baseUrl, partnerId, partnerKey, transport });
  const provider = createCommerceProvider({ provider: 'shopee', manifest: { platform: 'shopee', capabilities: ['catalog.read', 'orders.read', 'affiliate.links.write', 'analytics.read', 'webhooks.receive'], secretMode: 'server-only' }, transport, urlValidator });

  async function searchProducts({ tenantId, keyword, categoryId, pageNumber = 1, pageSize = 20 }) {
    const result = await client.searchItems({ keyword, categoryId, pageNumber, pageSize });
    const items = result?.payload?.items ?? [];
    return Object.freeze({
      provider: 'shopee',
      items: items.map((item) => Object.freeze({
        externalProductId: String(item?.item_id ?? ''),
        title: String(item?.name ?? ''),
        priceMinorUnits: Number(item?.price ?? 0),
        originalPriceMinorUnits: Number(item?.original_price ?? 0),
        currency: String(item?.currency ?? 'THB'),
        availability: item?.status === 'normal' ? 'IN_STOCK' : 'UNKNOWN',
        images: Array.isArray(item?.images) ? item.images.map((i) => String(i?.url ?? '')) : [],
        sellerId: String(item?.shop_id ?? ''),
        sellerName: String(item?.shop_name ?? ''),
        categoryId: String(item?.category_id ?? ''),
        sourceUrl: String(item?.item_url ?? ''),
        affiliateUrl: String(item?.affiliate_url ?? ''),
        metadata: Object.freeze({ ...(item?.extra ?? {}) })
      })),
      pageNumber,
      pageSize,
      totalPages: Number(result?.payload?.total_pages ?? 1),
      hasMore: Boolean(result?.payload?.has_more ?? false),
      nextPageToken: result?.payload?.cursor ?? null
    });
  }

  async function getProduct({ tenantId, externalProductId }) {
    const result = await client.getItemList({ categoryId: null, offsetItemId: externalProductId, pageSize: 1 });
    const items = result?.payload?.items ?? [];
    if (items.length === 0) return null;
    const item = items[0];
    return Object.freeze({
      externalProductId: String(item?.item_id ?? externalProductId),
      title: String(item?.name ?? ''),
      priceMinorUnits: Number(item?.price ?? 0),
      originalPriceMinorUnits: Number(item?.original_price ?? 0),
      currency: String(item?.currency ?? 'THB'),
      availability: item?.status === 'normal' ? 'IN_STOCK' : 'UNKNOWN',
      images: Array.isArray(item?.images) ? item.images.map((i) => String(i?.url ?? '')) : [],
      sellerId: String(item?.shop_id ?? ''),
      sellerName: String(item?.shop_name ?? ''),
      sourceUrl: String(item?.item_url ?? ''),
      affiliateUrl: String(item?.affiliate_url ?? ''),
      metadata: Object.freeze({ ...(item?.extra ?? {}) })
    });
  }

  async function generateAffiliateLink({ tenantId, externalProductId, originalUrl, siteId }) {
    const result = await client.generateAffiliateLink({ idempotencyKey: `${tenantId}:${externalProductId}`, siteId, originalUrl });
    return Object.freeze({
      affiliateUrl: String(result?.payload?.affiliate_url ?? result?.payload?.url ?? ''),
      trackingId: String(result?.payload?.tracking_id ?? result?.payload?.affiliate_tracking_id ?? ''),
      expiresAt: result?.payload?.expire_time ? new Date(result.payload.expire_time) : null
    });
  }

  return Object.freeze({
    ...provider,
    platform: 'shopee',
    client,
    searchProducts,
    getProduct,
    generateAffiliateLink
  });
}
