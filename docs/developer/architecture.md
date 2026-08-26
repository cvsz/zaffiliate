# Developer Handbook — Architecture

Authoritative long-form: `ARCHITECTURE.md`. This is the working map.

## Shape

Single-package ESM monorepo (no workspace tooling), zero-dep runtime philosophy.

```
apps/
  api      HTTP surface (/healthz,/readyz,/metrics,/go/:slug,/webhooks/:platform,/api/v1/*)
  web      CSP-first Control Plane (server-rendered JSON APIs + static views)
packages/
  contracts     normalized domain model + validator (schema.js), tenancy, grants, audit chain
  affiliate-core lifecycle runtime + commerce truth (price snapshots, promotions, claim revalidation)
  tiktok-shop   SDK, webhook signature, replay guard, event dedupe
  adapters      provider capability registry, Shopee/Lazada/Meta/YT boundaries, publishing boundary
  workflow      durable jobs engine (claims/retry/DLQ/approvals)
  identity-billing sessions, API keys, plans, ledger
  ai-content    LLM/media interfaces, prompt registry, content factory (personas/briefs/hooks/scripts)
  automation    policy plane, typed decisions, kill switches
  analytics     canonical event envelopes, dedupe, summarize
  intelligence  feature store → baseline ranker → recommendations → evaluation → decision gate
  db            pooled pg client, checksummed migrator, repos (analytics, publication_jobs)
  security      secrets(ref:), redaction, SSRF validation, rate limiting, JWKS, OAuth2/PKCE
  observability structured logs (redacting), metrics registry, trace context
  storage/events/supabase/release/control-plane/outreach/config  supporting planes
db/migrations    SQL migrations 001..006 + ROLLBACK.md classification
```

## Invariants worth defending

1. Tenant scoping: explicit `tenant_id` predicates AND RLS FORCE as defense-in-depth (`app_current_tenant_id()` GUC set per transaction).
2. Money: minor units, immutable snapshots, append-only corrections.
3. Providers behind capability manifests; unavailable ≠ improvised.
4. Autonomy only through the decision gate; kill switches predate features.
5. Fail closed everywhere; errors use the canonical envelope `{error:{code,message,request_id}}`.

## Data flow (golden chain)

Provider/webhook → ingress (signature→replay→dedupe) → affiliate-core runtime (outbox) → canonical envelopes → analytics/intelligence stores → recommendations → decision gate → publication_jobs → (provider publish) → attribution loop.
