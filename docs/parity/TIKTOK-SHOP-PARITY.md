# TikTok Shop Canonical Parity Matrix

Updated: 2026-08-22

Canonical target: `packages/tiktok-shop`.

Primary source donors:
- `cvsz/tiktok-shop-sdk` @ `0c53da6cbba91728401f79cda7156cc56a2cc7dd`
- `cvsz/tiktokshop-php` @ `dbbec213d9d118c443576d613571993090a843a5`

## Resource parity

| Capability | TS donor | PHP donor | Canonical target | Status |
|---|---|---|---|---|
| Request signing | yes | yes | `signing.js` | implementing |
| OAuth authorization URL | yes/expected | yes | `auth.js` | implementing |
| Authorization code exchange | yes/expected | yes | `auth.js` | implementing |
| Refresh token | yes/expected | yes | `auth.js` | implementing |
| Webhook signature verification | expected | yes | `webhook.js` | implementing |
| Replay-window validation | not evidenced | no | `webhook.js` | canonical hardening |
| Affiliate Creator | yes | yes | resource adapter | pending |
| Affiliate Partner | yes | yes | resource adapter | pending |
| Affiliate Seller | yes | yes | resource adapter | pending |
| Analytics | yes | yes | resource adapter | pending |
| Authorization/Seller | yes | yes | resource adapter | pending |
| Products/Global Products | yes | yes | resource adapter | pending |
| Orders | yes | yes | resource adapter | pending |
| Finance | yes | yes | resource adapter | pending |
| Fulfillment/Logistics | yes | yes | resource adapter | pending |
| Promotions | yes | yes | resource adapter | pending |
| Returns/Refunds | yes | yes | resource adapter | pending |
| Customer Service | inspect | yes | resource adapter | pending |
| Supply Chain | inspect | yes | resource adapter | pending |

## Canonical security differences

The canonical adapter intentionally strengthens legacy behavior:

- secret material is accepted only by server-side adapters;
- signing uses deterministic input normalization and timing-safe comparison;
- webhook verification enforces timestamp freshness/replay window in addition to signature validation;
- token persistence is an interface, not plaintext storage;
- network clients must enforce timeouts and normalized errors;
- retries are bounded and mutation idempotency is explicit;
- all calls carry tenant/audit/trace context outside provider secret material.

## Source evidence notes

The PHP donor constructs OAuth URLs under `https://auth.tiktok-shops.com`, exchanges authorization codes at `/api/v2/token/get`, and refreshes at `/api/v2/token/refresh`. Its client signs requests by sorting query parameters (excluding signature/access-token fields), concatenating path + key/value pairs + body where applicable, wrapping with the app secret, then HMAC-SHA256. Its webhook verifies HMAC-SHA256 over `app_key + raw_body` using the app secret.

No canonical resource is considered parity-complete until fixture/contract tests exist and the corresponding row is set to `complete`.
