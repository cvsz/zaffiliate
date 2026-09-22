# ARCHITECTURE MANDATE — SEPARATE AFFILIATE DOMAIN FROM TIKTOK DOMAIN

## 1. CORE BOUNDARY

Strictly separate:

1. **Affiliate Domain**
2. **TikTok Integration Domain**

They are independent bounded contexts.

### Affiliate is the core business domain.

Affiliate functionality MUST NOT depend directly on TikTok.

TikTok is an external distribution channel/provider that consumes outputs produced by the Affiliate domain.

The dependency direction MUST be:

```text
Affiliate Core
    │
    ├── Products
    ├── Merchants
    ├── Affiliate Links
    ├── Offers
    ├── Commissions
    ├── Content
    ├── Campaigns
    ├── Media Assets
    ├── Analytics
    └── Publishing Intent
            │
            ▼
     Distribution Layer
            │
            ├── TikTok
            ├── YouTube
            ├── Instagram
            ├── Facebook
            └── Future Providers
```

NOT:

```text
TikTok
 └── Affiliate
      └── Products
```

And NOT:

```text
Affiliate
 └── TikTok-specific models/services everywhere
```

---

# 2. AFFILIATE BOUNDED CONTEXT

Create or consolidate an explicit Affiliate domain.

Suggested logical structure:

```text
affiliate/
├── domain/
│   ├── product/
│   ├── merchant/
│   ├── offer/
│   ├── affiliate-link/
│   ├── campaign/
│   ├── content/
│   ├── media/
│   ├── commission/
│   ├── analytics/
│   └── publishing/
│
├── application/
│   ├── products/
│   ├── campaigns/
│   ├── content-generation/
│   ├── media-generation/
│   ├── affiliate-links/
│   ├── publishing/
│   └── analytics/
│
└── infrastructure/
    ├── persistence/
    ├── storage/
    ├── ai/
    └── providers/
```

Use the repository's existing architecture if it already has an equivalent structure. Do NOT blindly create duplicate modules.

---

# 3. TIKTOK BOUNDED CONTEXT

TikTok must be an isolated integration/provider boundary.

Suggested logical structure:

```text
integrations/
└── tiktok/
    ├── domain/
    │   ├── account/
    │   ├── oauth/
    │   ├── token/
    │   └── publishing/
    │
    ├── application/
    │   ├── connect-account/
    │   ├── refresh-token/
    │   ├── publish/
    │   ├── upload/
    │   └── sync/
    │
    └── infrastructure/
        ├── api/
        ├── oauth/
        ├── persistence/
        └── webhooks/
```

Again, adapt this to the repository's existing architecture rather than introducing unnecessary duplication.

---

# 4. DEPENDENCY RULE

The Affiliate domain MUST NOT import TikTok infrastructure.

Forbidden examples:

```text
affiliate/ProductService -> TikTokApi
affiliate/CampaignService -> TikTokClient
affiliate/ContentService -> TikTokOAuth
affiliate/AnalyticsService -> TikTokAccount
affiliate/PublishService -> TikTok-specific implementation
```

Instead:

```text
Affiliate
   ↓
Publishing Port / Distribution Port
   ↓
TikTok Adapter
```

Example:

```ts
interface PublishingProvider {
  publish(request: PublishRequest): Promise<PublishResult>;
  getStatus(request: PublishStatusRequest): Promise<PublishStatusResult>;
}
```

Then:

```text
Affiliate Application
        ↓
PublishingProvider
        ↓
TikTokPublishingProvider
```

The Affiliate application must not know that the provider is TikTok.

---

# 5. AFFILIATE MUST WORK WITHOUT TIKTOK

The following operations MUST remain functional even if:

* TikTok Developer App is not configured
* TikTok OAuth is unavailable
* TikTok account is disconnected
* TikTok token is expired
* TikTok API is unavailable
* TikTok production access has not been approved
* TikTok rate limits are exhausted
* TikTok is temporarily down

Affiliate functionality must still support:

```text
Product discovery
Product import
Product management
Affiliate link generation
Offer management
Campaign management
Content generation
Script generation
Caption generation
Media generation
Video processing
Asset management
Analytics
Commission tracking
Content scheduling
Publishing intent creation
```

TikTok failure must NOT make the Affiliate domain unavailable.

---

# 6. PUBLISHING ABSTRACTION

Do not model publishing as:

```text
TikTokPublishJob
```

inside the Affiliate core.

Model it generically:

```text
PublishJob
DistributionTarget
PublishingProvider
PublishingRequest
PublishingResult
PublishingStatus
```

Example:

```text
PublishJob
├── tenantId
├── campaignId
├── contentId
├── mediaAssetId
├── targetPlatform
├── providerAccountId
├── status
├── idempotencyKey
├── scheduledAt
├── publishedAt
└── failure
```

Then:

```text
targetPlatform = TIKTOK
```

is configuration/data, not a reason to couple the entire domain to TikTok.

---

# 7. PLATFORM ACCOUNT SEPARATION

Do not use a generic Affiliate account as a TikTok account.

Separate:

```text
Affiliate Account / Workspace
```

from:

```text
TikTok Account
```

Relationship:

```text
Tenant / Workspace
       │
       ├── Affiliate data
       │
       └── Distribution Accounts
              ├── TikTok Account
              ├── YouTube Account
              ├── Instagram Account
              └── ...
```

TikTok OAuth credentials belong exclusively to the TikTok integration boundary.

They MUST NOT be stored in:

```text
affiliate_products
affiliate_campaigns
affiliate_content
affiliate_links
affiliate_offers
```

unless there is a legitimate, explicitly modeled distribution relationship.

---

# 8. DATABASE SEPARATION

Audit the current schema.

Separate entities by responsibility.

### Affiliate entities

Examples:

```text
products
merchants
offers
affiliate_links
campaigns
content
media_assets
commissions
affiliate_events
publishing_intents
```

### TikTok entities

Examples:

```text
tiktok_accounts
tiktok_oauth_transactions
tiktok_tokens
tiktok_publish_records
tiktok_uploads
tiktok_webhook_events
```

Do not duplicate the same business entity merely because TikTok uses it.

For example:

```text
Product
```

must remain an Affiliate entity.

TikTok should reference the internal Product/Content/Media IDs when needed rather than maintaining a second competing Product model.

---

# 9. PRODUCT OWNERSHIP

Product data belongs to Affiliate.

TikTok does NOT own:

```text
product title
product description
product price
affiliate URL
commission
merchant
campaign
content strategy
```

TikTok integration may maintain platform-specific metadata such as:

```text
TikTok product ID
TikTok showcase association
TikTok-specific publishing metadata
TikTok-specific status
```

These must be treated as integration metadata.

---

# 10. CONTENT OWNERSHIP

Content generated for affiliate marketing belongs to Affiliate.

For example:

```text
AffiliateContent
├── productId
├── campaignId
├── hook
├── script
├── caption
├── CTA
├── hashtags
├── mediaAssetId
├── contentVersion
└── generationMetadata
```

TikTok-specific rendering/publishing information belongs to TikTok:

```text
TikTokPublishMetadata
├── tiktokAccountId
├── privacyLevel
├── publishId
├── uploadId
├── platformStatus
└── platformError
```

Do not mix these into one giant TikTok/Affiliate model.

---

# 11. AI PROVIDER SEPARATION

AI content generation is an Affiliate capability, not a TikTok capability.

The architecture should support:

```text
Affiliate Content
       ↓
AI Provider
       ├── OpenAI
       ├── Gemini
       ├── Claude
       └── Other provider
```

TikTok is downstream:

```text
Affiliate Content
       ↓
Media Pipeline
       ↓
Publishing
       ↓
TikTok
```

Do not implement:

```text
TikTokContentGenerator
```

unless the provider is genuinely TikTok-specific.

---

# 12. VIDEO PIPELINE SEPARATION

Video generation and processing belong to the media/content platform.

Pipeline:

```text
Affiliate Product
       ↓
Campaign
       ↓
Content
       ↓
Media Generation
       ↓
Video Processing
       ↓
Media Asset
       ↓
Publishing
       ↓
TikTok
```

TikTok should receive a validated media asset.

TikTok MUST NOT own:

* FFmpeg processing
* video generation
* clip generation
* loop generation
* media transcoding
* storage lifecycle
* generic media validation

unless a specific TikTok API requirement makes a thin adapter necessary.

---

# 13. AFFILIATE ANALYTICS VS TIKTOK ANALYTICS

Separate business analytics from platform analytics.

### Affiliate analytics

```text
clicks
conversions
commission
revenue
orders
ROI
campaign performance
product performance
affiliate-link performance
```

### TikTok analytics

```text
views
likes
comments
shares
followers
platform publishing status
platform engagement
```

Create a controlled integration between them rather than mixing their schemas.

Example:

```text
AffiliateCampaign
        │
        ├── Affiliate Metrics
        │
        └── Distribution Metrics
                └── TikTok Metrics
```

---

# 14. FAILURE ISOLATION

A TikTok outage must not break:

```text
Product management
Affiliate links
Campaign management
Content generation
Video generation
Media storage
Affiliate analytics
Commission tracking
```

A failed TikTok publish should result in:

```text
PublishJob = FAILED / RETRYING
```

not:

```text
AffiliateCampaign = FAILED
Product = FAILED
Content = FAILED
```

The failure boundary must remain at the distribution operation.

---

# 15. FEATURE FLAGS / CAPABILITIES

Do not hard-code assumptions that TikTok is always available.

Expose provider capability checks:

```text
TikTokConfigured
TikTokOAuthAvailable
TikTokPublishingAvailable
TikTokDirectPostAvailable
TikTokUploadAvailable
TikTokProductAssociationAvailable
```

These capabilities must affect only TikTok-related functionality.

Affiliate features should remain available regardless.

---

# 16. CONFIGURATION SEPARATION

Separate environment configuration into categories.

### Affiliate

```env
AFFILIATE_*
CONTENT_*
MEDIA_*
AI_*
STORAGE_*
ANALYTICS_*
```

### TikTok

```env
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
TIKTOK_SCOPES
TIKTOK_ENVIRONMENT
TIKTOK_API_BASE_URL
```

Do not make application startup fail because optional TikTok integration is not configured, unless the selected deployment mode explicitly requires TikTok.

Use explicit capability/configuration states instead.

---

# 17. AUTHORIZATION SEPARATION

Affiliate authorization:

```text
tenant
workspace
campaign
product
content
media
affiliate data
```

TikTok authorization:

```text
tenant
workspace
TikTok account
TikTok OAuth session
TikTok publishing operation
```

A user having permission to manage Affiliate content does not automatically imply permission to connect/disconnect a TikTok account.

Define separate permissions where appropriate:

```text
affiliate.products.read
affiliate.products.write
affiliate.campaigns.read
affiliate.campaigns.write
affiliate.content.read
affiliate.content.write
affiliate.analytics.read

tiktok.accounts.read
tiktok.accounts.connect
tiktok.accounts.disconnect
tiktok.publish
tiktok.publish.read
tiktok.settings.manage
```

Adapt naming to the existing authorization system.

---

# 18. API ROUTE SEPARATION

Do not expose everything under `/tiktok`.

Affiliate APIs should be independent:

```text
/api/affiliate/products
/api/affiliate/campaigns
/api/affiliate/content
/api/affiliate/media
/api/affiliate/analytics
/api/publishing/jobs
```

TikTok-specific APIs:

```text
/api/integrations/tiktok/connect
/api/integrations/tiktok/callback
/api/integrations/tiktok/accounts
/api/integrations/tiktok/publish
/api/integrations/tiktok/status
```

Preserve existing API conventions where appropriate.

---

# 19. FRONTEND SEPARATION

The UI should clearly separate:

```text
Affiliate
├── Products
├── Campaigns
├── Content
├── Media
├── Affiliate Links
├── Analytics
└── Commissions

Integrations
└── TikTok
    ├── Account
    ├── OAuth
    ├── Permissions
    ├── Publishing
    └── Platform Status
```

Do not make the Affiliate dashboard unusable merely because TikTok is disconnected.

Instead show:

```text
TikTok: Not Connected
```

while Affiliate functionality remains operational.

---

# 20. JOB/QUEUE SEPARATION

Use separate job types or queues where justified:

```text
affiliate.product.sync
affiliate.content.generate
affiliate.media.generate
affiliate.analytics.process

distribution.publish
distribution.status
distribution.retry

tiktok.oauth
tiktok.sync
tiktok.publish
tiktok.webhook
```

Do not let a TikTok worker own generic Affiliate processing.

Use the existing queue technology and conventions rather than introducing another queue system without justification.

---

# 21. TESTING REQUIREMENT

Tests MUST prove isolation.

### Affiliate tests

Affiliate tests must run successfully without TikTok credentials.

### TikTok tests

TikTok integration tests must run against mocked/provider-contract infrastructure unless explicitly running an integration environment.

### Failure isolation test

Prove:

```text
TikTok unavailable
      ↓
Affiliate remains operational
      ↓
Content generation remains operational
      ↓
Media generation remains operational
      ↓
Publish job becomes retryable/failed
```

Also test:

```text
TikTok account disconnected
TikTok token expired
TikTok API timeout
TikTok rate limit
TikTok approval unavailable
TikTok provider outage
```

None should corrupt Affiliate domain state.

---

# 22. SECURITY BOUNDARY

TikTok secrets MUST remain inside the TikTok integration boundary.

Never expose:

```text
TIKTOK_CLIENT_SECRET
access_token
refresh_token
OAuth authorization code
```

to:

```text
Affiliate frontend
Affiliate APIs
Affiliate logs
Affiliate analytics
AI prompts
content generation
media metadata
```

Token encryption, refresh, revocation and OAuth state handling belong to the TikTok integration.

---

# 23. EXTENSIBILITY REQUIREMENT

The architecture must make this possible without rewriting Affiliate:

```text
Affiliate
    ↓
PublishingProvider
    ├── TikTok
    ├── YouTube
    ├── Instagram
    ├── Facebook
    └── FutureProvider
```

Adding another publishing provider must NOT require modifying:

```text
Product domain
Campaign domain
Affiliate-link domain
Content domain
Commission domain
Core analytics
```

Only the distribution/provider layer should require platform-specific implementation.

---

# 24. MIGRATION REQUIREMENT

Inspect the existing codebase for TikTok/Affiliate coupling.

Search for:

```text
tiktok
affiliate
product
campaign
content
publish
oauth
account
token
video
showcase
commission
analytics
```

Identify:

* TikTok-specific fields inside Affiliate models
* Affiliate logic inside TikTok services
* TikTok API calls from generic services
* duplicated Product models
* duplicated Content models
* duplicated account models
* TikTok assumptions inside queues
* TikTok assumptions inside frontend
* TikTok environment variables used by Affiliate core
* TikTok credentials exposed to unrelated modules
* generic publishing implemented directly against TikTok

Refactor these safely.

Do NOT perform a blind rewrite.

Preserve existing behavior while establishing the correct boundaries.

---

# 25. ARCHITECTURAL ACCEPTANCE CRITERIA

The implementation is acceptable only if all of the following are true:

* Affiliate domain can operate without TikTok.
* TikTok integration can be disabled independently.
* TikTok credentials are isolated.
* TikTok OAuth is isolated.
* TikTok publishing is isolated.
* Product ownership remains in Affiliate.
* Campaign ownership remains in Affiliate.
* Content ownership remains in Affiliate.
* Media ownership remains in the generic media/content layer.
* Affiliate analytics are not dependent on TikTok.
* TikTok analytics are modeled as distribution/platform data.
* Publishing is provider-agnostic.
* TikTok is implemented as a provider/adapter.
* No Affiliate service directly depends on TikTok HTTP clients.
* No TikTok secret is exposed to Affiliate.
* TikTok failures do not corrupt Affiliate state.
* Affiliate tests do not require TikTok credentials.
* Adding another distribution provider does not require rewriting Affiliate core.
* Database ownership boundaries are clear.
* API boundaries are clear.
* Authorization boundaries are clear.
* Queue/job boundaries are clear.
* Documentation reflects the separation.

---

# 26. FINAL ARCHITECTURAL MODEL

The resulting system should conceptually be:

```text
                         ┌──────────────────────┐
                         │    Affiliate Core    │
                         │                      │
                         │ Products             │
                         │ Merchants             │
                         │ Offers                │
                         │ Campaigns             │
                         │ Affiliate Links       │
                         │ Content               │
                         │ Media                 │
                         │ Commissions           │
                         │ Affiliate Analytics   │
                         └──────────┬───────────┘
                                    │
                                    │ generic contracts
                                    ▼
                         ┌──────────────────────┐
                         │ Distribution Layer   │
                         │                      │
                         │ PublishJob           │
                         │ PublishingProvider   │
                         │ DistributionAccount  │
                         └──────────┬───────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  │                 │                 │
                  ▼                 ▼                 ▼
           ┌────────────┐    ┌────────────┐    ┌────────────┐
           │   TikTok   │    │  YouTube   │    │ Instagram  │
           │ Integration│    │ Integration│    │ Integration│
           └────────────┘    └────────────┘    └────────────┘
                  │
                  ▼
           TikTok Developer
           OAuth / API / Publish
```

## ABSOLUTE RULE

**Affiliate is the business core. TikTok is a distribution integration.**

Never reverse this dependency.

Never make TikTok a prerequisite for the Affiliate platform.

Never allow TikTok-specific implementation details to leak into the Affiliate domain.

If the current repository violates this boundary, refactor it as part of the production-grade upgrade.
