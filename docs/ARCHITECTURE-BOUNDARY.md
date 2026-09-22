# Architecture Boundary: Affiliate vs TikTok

## Established by: production-grade upgrade (TIKTOK-DEV-UPGRADE-PRODUCTIONS.md)

## Boundary Rule
Affiliate is the business core. TikTok is a distribution integration.
Affiliate MUST NOT depend on TikTok. TikTok depends on Affiliate outputs.

```text
Affiliate Core
    │
    ▼
Distribution Layer (PublishingProvider)
    │
    ├── TikTok
    ├── YouTube
    ├── Instagram
    └── Future Providers
```

## Verified Isolation

### Affiliate domain (zero TikTok dependency)
- `packages/affiliate-core/` — No tiktok imports
- `packages/db/src/affiliate-core-repo.js` — No TikTok provider imports
- `packages/ai-content/src/factory.js` — Generic platform field, no TikTok infra imports
- `packages/ai-content/src/video-factory.js` — No TikTok references
- `db/migrations/001-015` — Affiliate/Shared infrastructure only

### TikTok integration (isolated)
- `packages/tiktok-developer/` — TikTok OAuth/API only
- `packages/tiktok-shop/` — TikTok webhooks/signing only
- `packages/db/src/tiktok-accounts-repo.js` — TikTok account persistence only
- `packages/adapters/src/tiktok-publisher.js` — TikTok publishing adapter only
- `db/migrations/016` — TikTok tables only (`tiktok_accounts`)

### Composition root knows about both
- `apps/api/src/production-server.js` — Wires all providers in composition root
- `apps/api/src/server.js` — Routes to domain-specific handlers

### Shared infrastructure (generic, provider-agnostic)
- `packages/adapters/src/publishing.js` — Generic publishing adapter with `generatePublishingIdempotencyKey`
- `packages/events/src/` — Event bus
- `packages/security/src/` — Security primitives
- `packages/db/src/` — Database primitives (RLS, transactions)

## Key Refactoring Performed

**Before**: `packages/ai-content/src/tiktok-showcase.js` imported `generatePublishingIdempotencyKey` from `packages/adapters/src/tiktok-publisher.js` (TikTok-specific module).

**After**: `generatePublishingIdempotencyKey` lives in `packages/adapters/src/publishing.js` (generic publishing adapter). `tiktok-publisher.js` re-exports it for backward compatibility. `tiktok-showcase.js` imports from generic `publishing.js`.

## Database Ownership

### Affiliate tables (migrations 001-015)
products, offers, affiliate_links, campaigns, conversions, audit_events, auth_sessions, oauth_pending_authorizations, oauth_provider_tokens, publication_jobs, etc.

### TikTok tables (migration 016)
tiktok_accounts (encrypted tokens, RLS FORCE, unique constraints)

## Commerce Source Separation

Commerce sources (Shopee, TikTok Shop, Lazada, Amazon) are external data providers behind adapters.
They are NOT the Affiliate Core.

### Verified Isolation

#### Affiliate domain (zero commerce source dependency)
- `packages/affiliate-core/` — No shopee/tiktok-shop/lazada imports
- `packages/db/src/affiliate-core-repo.js` — No commerce provider imports
- Canonical entities (`Product`, `Offer`, `Campaign`, `AffiliateLink`) are source-neutral

#### Commerce sources (isolated behind adapter interface)
- `packages/adapters/src/shopee.js` — Shopee API client only
- `packages/adapters/src/commerce-provider.js` — CommerceProvider interface
- `packages/adapters/src/shopee-provider.js` — Shopee as CommerceProvider
- `packages/db/src/shopee-th-repo.js` — Shopee persistence only
- `db/migrations/017` — Commerce source tables (`product_sources`, `product_source_metadata`, `sync_jobs`)

### Database Ownership

#### Affiliate tables (migrations 001-015)
products, offers, affiliate_links, campaigns, conversions, audit_events, etc.
- Products use generic `platform` field (source-neutral)
- Unique constraint: `(tenant_id, platform, external_product_id)` allows multi-source

#### Commerce source tables (migration 017)
- `product_sources` — Maps canonical products to commerce sources (provider + external_id)
- `product_source_metadata` — Provider-specific metadata (isolated from canonical entities)
- `sync_jobs` — Commerce sync job state machine (pending → running → completed/partial/failed)

### Architecture Boundary

```text
Commerce Sources          Affiliate Core          Distribution Layer
Shopee ─────────┐
TikTok Shop ────┤──→ Product Ingestion ──→ Product ──→ Offer ──→ Campaign ──→ Content ──→ PublishingIntent ──→ DistributionProvider
Lazada ─────────┘     Provider Adapter
Amazon ─────────┘
```

## API Route Separation
- `/api/v1/affiliate/*`, `/api/v1/campaigns/*`, `/api/v1/conversions/*`, `/api/v1/publications/*`, `/api/v1/commerce/*` — Affiliate domain
- `/api/v1/tiktok/*` — TikTok integration
- `/api/v1/oauth/*` — Generic OAuth (provider-agnostic)
- `/webhooks/:platform` — Generic webhook handling (provider-specific verification in adapters)
