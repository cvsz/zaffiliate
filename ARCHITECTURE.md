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

## Automation control plane (AUTO-001..003/007, 2026-08-24)

`packages/automation` is the policy layer every autonomous action must pass through before execution:

```text
Proposed action
  → tenant match (cross-tenant = DENY)
  → kill switches (global/org/provider/account/campaign/workflow)
  → risk routing (critical=DENY, high=specialist approval)
  → platform allowlist
  → quality/compliance score floors
  → frequency caps (DEFER to next window)
  → AI budgets (daily=DENY, campaign=approval)
  → automation mode (manual/draft_only/approval_required/auto_safe/autonomous)
  → typed AutomationDecision {ALLOW|APPROVAL_REQUIRED|MANUAL_REQUIRED|DENY|DEFER, reason, checks[], policyVersion}
```

Every evaluation appends a hash-chain-compatible audit event (`automation.decision`) including denials. `dryRun` computes real decisions while marking zero side effects; shadow mode and durable workflow-state persistence are the next slices (AUTO-005/008). Mode semantics: draft-only never publishes; auto-safe publishes only pre-approved content classes; autonomous requires the `allowAutoPublish` flag on top of all hard gates.

## Measurement layer (DATA-001/002/003, 2026-08-24)

`packages/analytics/src/events.js` is the canonical ingestion boundary: 17-type versioned event taxonomy, mandatory source classification (first-party / provider-reported / modeled… never merged invisibly), frozen lineage ids on every envelope, and deterministic deduplication (`provider + external_event_id`, payload-fingerprint fallback) so duplicate webhooks can never double-count conversions or commissions. Raw events are immutable and tenant-partitioned; semantic metrics (`summarize`) are derived only from accepted events, with pending commission excluded from net revenue. Metric definitions live in `docs/ANALYTICS.md`.

## Commerce intelligence (COM-001..006, 2026-08-24)

`packages/affiliate-core/src/commerce.js`: Product (stable) vs Offer (provider commercial state) separation; append-only PriceSnapshots; typed Promotions with clock-resolved lifecycle (UPCOMING/ACTIVE/EXPIRING/EXPIRED, UNKNOWN never active); inventory normalization with UNKNOWN never purchasable; configurable per-claim freshness thresholds; pre-publish `revalidateCommercialClaim` returning ALLOW or fail-closed BLOCK (`stale_price`, `stale_evidence`, `promotion_expired`) with regeneration actions. Details and metric formulas: docs/AFFILIATE-COMMERCE.md.

## Mission Control UI foundation (UI-001..005, UI-020..022, 2026-08-24)

Control plane web gains a semantic design-token layer (`apps/web/public/tokens.css`: severity INFO/SUCCESS/WARNING/DANGER/CRITICAL as color+text-label pairs — never color-only — plus surface/foreground/muted/primary themes with light/dark overrides, spacing/radius/typography/z-index scales, reduced-motion support) and a real API-backed Mission Control: `GET /api/ui/overview` (tenant-gated like every control-plane route) returns six primary KPIs (net commission, conversions, affiliate clicks, published content, pending approvals, critical failures), secondary signals (CTR/CVR/EPC/pending commission), and a Critical Action Center derived from injected live stores — active kill switches (DANGER), expiring promotions (WARNING), provider degradation (CRITICAL). Zero-state and degraded states are explicit: when a source fails, KPIs render zero but are labeled 'not confirmed zeros' so stale data never masquerades as real-time. Provider-controlled strings are HTML-escaped server-side (`escapeHtml`) before reaching any render path.
