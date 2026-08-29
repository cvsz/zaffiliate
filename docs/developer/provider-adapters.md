# Developer Handbook — Provider Adapters

Manifest of record: `packages/adapters/src/capabilities.js` (canonical manifests) + `provider-registry.js` (availability states). Parity details: `docs/PROVIDER-CAPABILITY-MATRIX.md`, `docs/parity/TIKTOK-SHOP-PARITY.md`.

## Capability model

Adapters declare capabilities from a fixed vocabulary (`catalog.read`, `offers.read`, `links.create`, `orders.read`, `commissions.read`, `content.publish`, `analytics.read`, `webhooks.receive`). States: `available | approval_required | manual | unsupported | temporarily_disabled`. Mutating operations fail closed without an approval id; manual capabilities can never be automated.

## Adding/adjusting an adapter

1. Extend the manifest — never special-case by platform string in domain code.
2. Credentials are `ref:` paths only (`assertCredentialReference` rejects inline secrets).
3. Resilience via `packages/tiktok-shop/src/resilience.js` (timeout/retry/breaker) and token-bucket rate limits per platform.
4. Webhook ingestion goes through `apps/api/src/business.js#ingestWebhook`: capability gate → parameter presence → signature (TikTok canonical scheme or generic HMAC over `<ts>.<body>`) → replay guard → payload validation → tenant-scoped resolution.
5. Contract tests with mocked transports only; live verification waits for real credentials (B2) and updates `last_verified_at`.

## OAuth for providers

Use `packages/security/src/oauth.js` (`createOAuthFlow` + `createTokenStore`): PKCE S256, injectable transport, refresh with rotation, revocation → REAUTH_REQUIRED. Register flows in `buildServer({ oauthRegistry })`; see `test/oauth-flow.test.js` for the full browser-flow harness pattern.
