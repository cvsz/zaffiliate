# Affiliate Commerce Intelligence

Offer engine, freshness gate and commercial-claim safety (`packages/affiliate-core/src/commerce.js`).

## Model separation

- **Product** (stable identity) lives in `affiliate-core` domain + contracts `ProductSchema`.
- **Offer** (provider-specific commercial state) is versioned per provider: provider/merchant/product ids, currency, list/sale/effective price in minor units, inventory status, commission rate/amount, validity window, source + `verifiedAt`. A sale price above list price without promotion context is rejected at ingestion (data-quality gate §65).
- **PriceSnapshot** — append-only chronological pricing evidence; history is never overwritten and is frozen once recorded.
- **Promotion** — 11-type taxonomy with mandatory start/end windows; status resolved through the clock: UPCOMING → ACTIVE → EXPIRING (final 10% of window) → EXPIRED. Unverified promotions are UNKNOWN and **never treated as ACTIVE/CANCELLED**.
- **Inventory** — IN_STOCK / LOW_STOCK / OUT_OF_STOCK / PREORDER / UNKNOWN; only the first three are purchasable. UNKNOWN is never presented as available.

## Freshness gate

Configurable per claim type (defaults: price 30m · inventory 10m · coupon 30m · commission 6h · promotion 30m). Claims older than their threshold fail closed.

## Pre-publish commercial revalidation

`revalidateCommercialClaim(tenantId, {offerId, claim})` → `ALLOW | BLOCK`:

| Condition | Decision |
|---|---|
| PRICE/DISCOUNT claim matches latest snapshot within freshness window | ALLOW (with evidence: verified price, computed %) |
| Claimed price ≠ latest snapshot price | BLOCK `stale_price` → actions: regenerate, remove_dynamic_claim |
| Claimed % ≠ verified discount (±1pt) | BLOCK `stale_price` |
| Evidence older than freshness threshold | BLOCK `stale_evidence` |
| Bound promotion EXPIRED / CANCELLED / UNKNOWN at publish time | BLOCK `promotion_expired` |

Golden scenario enforced by tests: list ฿1,000 / sale ฿800 → verified "ลด 20%" allowed for a 19:30 slot against a 20:00 expiry; moving sale to ฿850 blocks the old creative and demands regeneration.

## Isolation & audit posture

All offers/promotions/snapshots are tenant-partitioned; cross-partition reads return null (offers) or throw `cross_tenant_access` (snapshots). Snapshot evidence is immutable so historical price context (§25) remains reconstructable.
