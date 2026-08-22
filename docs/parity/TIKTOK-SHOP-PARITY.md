# TikTok Shop Canonical Parity Matrix

Updated: 2026-08-22

Canonical target: `packages/tiktok-shop`.

Primary source donors:
- `cvsz/tiktok-shop-sdk` @ `0c53da6cbba91728401f79cda7156cc56a2cc7dd`
- `cvsz/tiktokshop-php` @ `dbbec213d9d118c443576d613571993090a843a5`

## Resource parity

| Capability | TS donor | PHP donor | Canonical target | Status |
|---|---|---|---|---|
| Request signing | yes | yes | `signing.js` | complete |
| OAuth authorization URL | yes/expected | yes | `auth.js` | complete |
| Authorization code exchange | yes/expected | yes | `auth.js` | complete |
| Refresh token | yes/expected | yes | `auth.js` | complete |
| Webhook signature verification | expected | yes | `webhook.js` | complete |
| Replay-window validation | not evidenced | no | `webhook.js` + `event-dedupe.js` | complete |
| Timeout/retry/backoff/circuit breaker | partial | no | `resilience.js` | complete |
| Cursor pagination contract | partial | partial | `pagination.js` | complete |
| Mutation idempotency keys | partial | no | `resources.js` (all mutating calls) | complete |
| Event-id dedupe store interface | no | no | `event-dedupe.js` | complete |
| Affiliate Creator | yes | yes | `resources.js` createAffiliateCreatorApi | complete |
| Affiliate Partner | yes | yes | `resources.js` createAffiliatePartnerApi | complete |
| Affiliate Seller | yes | yes | `resources.js` createAffiliateSellerApi | complete |
| Analytics | yes | yes | `resources.js` createAnalyticsApi | complete |
| Authorization/Seller | yes | yes | `resources.js` createAuthorizationApi | complete |
| Products/Global Products | yes | yes | `resources.js` createProductApi | complete |
| Orders | yes | yes | `resources.js` createOrderApi | complete |
| Finance | yes | yes | `resources.js` createFinanceApi | complete |
| Fulfillment/Logistics | yes | yes | `resources.js` createFulfillmentApi/createLogisticsApi | complete |
| Promotions | yes | yes | `resources.js` createPromotionApi | complete |
| Returns/Refunds | yes | yes | `resources.js` createReturnRefundApi | complete |
| Customer Service | inspect | yes | `resources.js` createCustomerServiceApi | complete |
| Supply Chain | inspect | yes | `resources.js` createSupplyChainApi | complete |

## Verification

- Contract/fixture tests: `test/tiktok-resources.test.js` (29 assertions) covers resilience transitions, pagination caps, dedupe TTL, replay windows, exhaustive mutating-call idempotency enforcement across every group, and registry completeness.
- Signer/auth/webhook coverage: `test/tiktok-client.test.js`, `test/tiktok-shop.test.js`.
- Live-provider conformance remains gated on sandbox credentials and is tracked under EP-11 production validation; it is not required for canonical source parity.

## Canonical security differences

The canonical adapter intentionally strengthens legacy behavior:

- secret material is accepted only by server-side adapters;
- signing uses deterministic input normalization and timing-safe comparison;
- webhook verification enforces timestamp freshness/replay window in addition to signature validation;
- token persistence is an interface, not plaintext storage;
- network clients must enforce timeouts and normalized errors (`resilience.js`);
- retries are bounded and mutation idempotency is explicit and mandatory for mutating calls;
- all calls carry tenant/audit/trace context outside provider secret material.
