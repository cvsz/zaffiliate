# zaffiliate Architecture

## Principles

- Canonical domain model first; platform adapters remain replaceable.
- Browser/client code never receives provider secrets.
- Every mutating operation is tenant-scoped, authenticated, authorized, idempotent and auditable.
- External side effects use durable workflows, transactional outbox patterns and bounded retry policies.
- TikTok is the first-class adapter, not the core domain.
- Backward compatibility is explicit and contract-tested.

## Logical architecture

```text
Web / CLI / Admin
      |
      v
API Gateway / BFF
      |
      +--> Identity + RBAC/ABAC
      +--> Affiliate Core
      |      +--> Campaigns
      |      +--> Creators/Partners
      |      +--> Products/Links
      |      +--> Attribution/Analytics
      |
      +--> Outreach ----> Provider adapters (email/manual/platform APIs)
      +--> Content AI --> LLM/media provider adapters
      +--> Billing -----> Ledger/Metering
      +--> Workflow ----> Durable queue/workers
      +--> Webhook Ingress --> verification/dedupe/outbox
      |
      v
PostgreSQL + Redis/Queue + Object Storage
      |
      v
Audit + Logs + Metrics + Traces
```

## Domain boundaries

### Affiliate Core
Owns campaigns, affiliate partners/creators/sellers, products, links, commissions, attribution state and normalized platform-independent entities.

### TikTok Adapter
Owns TikTok authentication/signing, endpoint mapping, pagination, quotas, retries, token lifecycle and webhook platform specifics. TypeScript implementation is primary. PHP compatibility is separately versioned and parity-gated.

### Outreach
Owns consent, suppression lists, templates, message rendering, send budgets, quiet hours, delivery state and provider adapters. Direct SMTP/platform mutation is never performed from CLI/UI code.

### Workflow
Owns durable jobs and state transitions: `pending -> approved/ready -> running -> succeeded|failed|cancelled`. Every mutation carries tenant ID, actor, idempotency key, correlation ID and policy decision.

### Billing
Double-entry or equivalently reconcilable ledger semantics; immutable transaction records, metering, quotas and plan enforcement. Wallet credits cannot be created by an unauthenticated or unverified client request.

### Content AI
Provider-neutral LLM/media generation boundary with prompt/version provenance, cost/metering, safety controls, deterministic input snapshots where practical, and no provider secret exposure to clients.

### Audit
Append-only evidence for auth decisions, mutations, webhooks, retries, billing entries, credential rotation events and administrative actions.

## Data model baseline

Every tenant-owned table includes `tenant_id`. Mutable business entities include `version`, timestamps and actor provenance. External IDs are namespaced by platform/account. Webhook events have unique platform/event IDs. Durable jobs and outbox messages have unique idempotency keys.

## Reliability

- timeouts on all network calls
- exponential backoff + full jitter
- Retry-After handling
- circuit breakers for unstable upstreams
- durable queues and DLQs
- transactional outbox for state + event consistency
- idempotent consumers
- replay tooling with audit evidence

## Deployment

Start with a modular monolith plus independent workers unless load/evidence requires service extraction. Keep boundaries package-enforced so identity, billing, webhook ingress and workload workers can scale independently later without distributed-system overhead on day one.

## Compatibility

Public contracts are versioned. TikTok SDK behavior is validated against both TypeScript and PHP legacy expectations. Deprecated endpoints require a migration window and telemetry proving clients have moved before removal.
