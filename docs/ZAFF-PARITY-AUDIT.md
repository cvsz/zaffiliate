# `zaff` → `zaffiliate` parity audit

Updated: 2026-09-02

`zaffiliate` remains the canonical runtime. It already exceeds `zaff` in TikTok
Shop coverage, workflow safety, tenant isolation, analytics, storage, Redis
events, OAuth/JWKS, release controls, and the MoneyPrinterTurbo integration.
Copying the TypeScript workspace wholesale would regress those boundaries.

## Remaining useful gaps

| Capability present in `zaff` | Current `zaffiliate` state | Upgrade path |
| --- | --- | --- |
| Meta Graph post/photo publishing and insights | Generic publishing request only | Added provider-native adapter with server-side credential resolution |
| YouTube resumable upload, analytics and quota accounting | Generic publishing request only | Added provider-native adapter with deterministic quota periods |
| Password login and Argon2id | OAuth/JWKS and API keys; no password contract | Defer until product explicitly requires password identities |
| Account recovery | No password identity to recover | Add only with password auth, one-time tokens and durable revocation |
| Campaign/link/conversion repositories | Rich domain runtime; persistence coverage remains partial | Add repositories behind existing tenant/RLS contracts |

## Porting rules

- Keep credentials server-only and pass `ref:` identifiers through application
  boundaries.
- Require approval and idempotency evidence before provider mutations.
- Never put provider access tokens in URLs, request bodies, logs, or `.env.example`.
- Preserve the Node.js 22 ESM runtime and Ubuntu/Compose deployment model.
- Port behavior with tests; do not copy `zaff` workspace/configuration files.

## Verification

The provider test suite covers credential isolation, approval/idempotency gates,
Meta insights, retry classification, YouTube resumable sessions, HTTPS-only
upload URLs, numeric analytics normalization, and quota reset/exhaustion.
