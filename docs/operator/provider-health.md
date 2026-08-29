# Operator Handbook — Provider Health

Capability truth lives in `packages/adapters/src/provider-registry.js` (states: available / approval_required / manual / unsupported / temporarily_disabled) and `docs/PROVIDER-CAPABILITY-MATRIX.md`. Only verified capabilities may be treated as production-ready.

## Current verified status

| Provider | Auth | Catalog | Publishing | Analytics | Notes |
|---|---|---|---|---|---|
| TikTok Shop | signed SDK (mock/sandbox) | sandbox/mocked | capability states enforced | mocked | full SDK present |
| Shopee | HMAC webhook ingest live | — | — | conversions via webhook | session pooler verified |
| Lazada | signed client | — | — | — | client only |
| Meta / YouTube | absent | absent | boundary only | absent | BLOCKED on credentials (B2) |

## Health signals to watch

- `WEBHOOK_SIGNATURE_FAILURE` security events (per platform) — sudden spikes mean provider config drift or forgery attempts.
- Rate-limit events per tenant on `/go` and `/webhooks` (429s with Retry-After).
- Token lifecycle: OAuth stores expose refresh state; a `REAUTH_REQUIRED` from the token store means the provider revoked consent — re-run the authorize flow for that provider (`/api/v1/oauth/:provider/authorize?userId=...`) after fixing credentials.

## Provider outage drill (tabletop)

1. Kill connectivity to one provider (or flip its registry state to `temporarily_disabled`).
2. Expected: other providers keep operating; jobs targeting the dead provider fail into retry/DLQ; no cross-provider degradation.
3. Recovery: restore, allow retries, verify reconciliation (`scripts/reconcile.mjs`).

## Credential rotation

Rotate by writing new material under the same `ref:` paths (`ref:providers/<platform>/...`, `ref:oauth/<provider>/client_secret`, `ref:webhooks/<platform>`) and restarting the API. Evidence template: `docs/migration/credential-rotation-evidence.md`.
