# TikTok Sandbox Demo Script (reviewer walkthrough)

Every step maps to a real surface in this repository. Steps marked **[EXTERNAL]** happen in TikTok systems and produce the evidence artifacts listed in TIKTOK-APP-REVIEW.md §6.

```text
Official website → Privacy / Terms / App icon → Connect TikTok →
TikTok Sandbox OAuth → Requested scopes → Authorize → OAuth callback →
Connected account → Actual zAffiliate operation → Result/receipt →
Disconnect / revoke
```

## 1) Official website + legal surfaces

```sh
curl -s https://zaffiliate.zeaz.dev/            | grep -E 'zaffiliate|public-footer'
curl -s https://zaffiliate.zeaz.dev/privacy     | grep -E 'Privacy Policy|seller.affiliate_collaboration|Retention'
curl -s https://zaffiliate.zeaz.dev/terms       | grep -E 'Terms of Service|acceptable use|Governing law'
```

Reviewer sees the brand icon on both pages (`/icon.svg`) and the site favicon; no login required anywhere in this step.

## 2) Connect TikTok (start authorization)

```sh
curl -s "https://zaffiliate.zeaz.dev/api/v1/oauth/tiktokshop/authorize?userId=<user-id>"
# → 302 {"authorizeUrl":"https://services.tiktokshop.com/open/oauth/authorize?app_key=…&state=<one-time>","state":"…","expiresAt":…}
```

## 3) TikTok Sandbox OAuth — requested scopes → Authorize **[EXTERNAL]**

The seller opens `authorizeUrl`, authenticates as the sandbox/test shop, reviews the consent screen listing exactly:

```text
seller.affiliate_collaboration.read
seller.affiliate_collaboration.write
```

and presses **Authorize**. TikTok redirects to our callback with `code` + `state`.

## 4) OAuth callback (token exchange, server-side)

```sh
# executed by the platform redirect; equivalent probe:
curl -s "https://zaffiliate.zeaz.dev/api/v1/oauth/tiktokshop/callback?state=<state>&code=<code>"
# → 200 {"linked":true,"provider":"tiktokshop","expiresAt":…}
```

Server exchanges the code at the token endpoint using app credentials from the secret manager. Tokens never appear in any response body (contract-tested).

## 5) Connected account

Connections view shows: seller name/region/open-id, granted scopes, connection health. Underlying identity link is recorded with an audit event.

## 6) Actual zAffiliate operation

With scopes granted, affiliate collaboration reads/writes power:
- offer/commission context for the connected shop,
- policy-gated publishing workflows (every autonomous action passes `/api/v1/intelligence/gate`).

## 7) Result/receipt

```json
{"ok":true,"provider":"tiktokshop","operation":"<idempotency-keyed operation>","audit":"intelligence.gate_decision"}
```

## 8) Disconnect / revoke

```sh
curl -X POST https://zaffiliate.zeaz.dev/api/v1/oauth/tiktokshop/disconnect \
  -H 'content-type: application/json' -d '{"userId":"<user-id>"}'
# → 200 {"disconnected":true,"provider":"tiktokshop","removedLinks":1,
#        "dataDeleted":["stored_tokens","account_link"]}
```

Stored tokens are deleted immediately; the link is removed; the action is audited. Re-authorizing later starts a fresh flow.
