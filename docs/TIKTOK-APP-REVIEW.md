# TikTok Shop App Review — Package

Target app: zaffiliate (TikTok Shop OpenAPI). This document is the resubmission package index and reviewer checklist.

## 1. Products & scopes requested (exact)

| Product | Scope | Used for | Surfaces |
|---|---|---|---|
| Affiliate collaboration | `seller.affiliate_collaboration.read` | Read affiliate collaboration data for the connected seller shop (offers/commission context) | Connections → Connected account; commission reconciliation |
| Affiliate collaboration | `seller.affiliate_collaboration.write` | Manage affiliate collaboration objects on behalf of the connected seller | Publishing/offer workflows behind approval policy |

**Scope hygiene before resubmit**: any scope previously requested but not exercised by the current build must be removed from the request. Current build requests exactly the two scopes above; nothing else.

## 2. Public web presence (no login required)

| Requirement | URL |
|---|---|
| Official website | `https://zaffiliate.zeaz.dev/` |
| Privacy Policy | `https://zaffiliate.zeaz.dev/privacy` |
| Terms of Service | `https://zaffiliate.zeaz.dev/terms` |
| App icon / favicon | same brand icon (`/icon.svg`) shown in header of both legal pages and as site favicon |

Both pages carry a public footer: `Privacy · Terms · Contact (support@zeaz.dev)`.

## 3. Data handling summary for reviewers

- Tokens are stored **server-side only**, referenced through a secret manager; never delivered to browsers.
- Requested scopes are used exclusively to deliver the seller-enabled affiliate features described above.
- Disconnect removes stored tokens and the account link immediately and is audited:
  `POST /api/v1/oauth/tiktokshop/disconnect {"userId": "..."}` → receipt `{disconnected, provider, removedLinks, dataDeleted:["stored_tokens","account_link"]}`.
- Platform-side deauthorization is detected by the refresh lifecycle (`REAUTH_REQUIRED`) which stops all data pulls for that shop.
- Deletion/export requests: privacy@zeaz.dev; retention rules in the Privacy Policy §5.

## 4. Automated verification (CI-enforced)

`test/tiktok-app-review.test.js`
- `/privacy` and `/terms` render without authentication with required sections (data processed, TikTok specifics incl. exact scope strings, retention/deletion, contact), brand icon, footer links.
- Favicon/icon served with correct content type; index carries favicon + public footer links.
- Secret isolation: no token markers (`TTP_`, refresh/client secret material) in any public page or API response body.
- Disconnect flow: revokes tokens, unlinks identity, returns deletion receipt; idempotent when nothing linked; unknown provider 503.

Run: `node --test test/tiktok-app-review.test.js`

## 5. OAuth endpoints (must match developer portal configuration)

| Purpose | Value |
|---|---|
| Authorize | `https://services.tiktokshop.com/open/oauth/authorize?app_key=<key>&state=<state>` |
| Callback / redirect URI | `https://zaffiliate.zeaz.dev/api/v1/oauth/tiktokshop/callback` |
| Token endpoint | `https://auth.tiktokshop.com/open/oauth/token/get` |
| Disconnect (app-side) | `POST /api/v1/oauth/tiktokshop/disconnect` |
| State handling | server-owned single-use pending state, TTL 10 minutes |

## 6. External evidence checklist (cannot be produced by code)

- [ ] Domain/URL ownership verification completed in TikTok partner portal
- [ ] Sandbox authorization performed by a real test seller ("Jjj test shop", region ID) — **captured 2026-08-26** with granted scopes exactly as listed above
- [ ] Reviewer demo video walking the sandbox flow (see TIKTOK-SANDBOX-DEMO.md)
- [ ] Final TikTok approval received
