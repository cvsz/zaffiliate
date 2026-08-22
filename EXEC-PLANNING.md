# zaffiliate Master Execution Planning

Updated: 2026-08-22

## Mission

Consolidate `cvsz/zaffhub`, `cvsz/ztsaff`, `cvsz/tiktok-shop-bot`, `cvsz/tiktok-shop-sdk`, `cvsz/tiktokshop-php`, `cvsz/zlttbots`, and `cvsz/zttlbots` into one canonical enterprise-grade affiliate-commerce platform: `cvsz/zaffiliate`.

The final system must be production-ready, multi-tenant, auditable, reversible, secure by default, observable, idempotent, testable and operable without relying on any legacy repository at runtime.

## Execution contract

Work proceeds as bounded vertical slices. Every implementation slice must include: production code, contracts/schema/migrations where applicable, automated tests, security review, telemetry/observability impact, rollback method, source-provenance evidence and CI evidence. No legacy repository may be permanently deleted during an implementation slice.

A slice is not DONE merely because files exist. DONE means its acceptance criteria are evidenced.

## Current state

- EP-02 bootstrap baseline: implemented on `main` (workspace, API health/readiness, tests, CI definition, Docker/Compose, Postgres/Redis baseline).
- EP-03 tenant-isolation/audit contract: merged through PR #1 after successful CI.
- EP-00 and EP-01 remain hard retirement blockers because trusted-local mirror/bundle/restore and credential-rotation evidence cannot be fabricated by GitHub API mutations.
- Legacy deletion remains fail-closed.

---

# Phase A — Migration integrity and security closure

## EP-00 — 100% migration ledger + history preservation

### Deliverables
- enumerate every blob from each pinned legacy snapshot;
- row schema: `source_repo`, `source_ref`, `path`, `blob_sha`, `size`, `class`, `action`, `canonical_destination`, `reason`, `validation`;
- classes: PORT, REWRITE, REFERENCE, DROP-GENERATED, DROP-UNRELATED, QUARANTINE-SECRET;
- detect duplicate content across repositories;
- inventory branches/tags/releases/issues/PRs required as provenance;
- create `git clone --mirror` backups for all seven repositories;
- create `git bundle --all` artifacts and run `git bundle verify`;
- SHA-256 all backups/manifests;
- clean-room restore drill and ref comparison.

### Done when
100% of source blobs are classified with no unresolved path; backup manifests are immutable; restore drill reproduces required refs.

## EP-01 — Legacy secret incident closure

### Deliverables
- rotate/revoke every credential potentially derived from tracked `ztsaff` runtime secret material;
- scan current trees and complete history for all seven repositories;
- create credential-rotation evidence without storing secrets;
- prohibit tracked runtime `.env` material via `.gitignore`, CI policy and repository conventions;
- server-side secret-manager adapter contract;
- structured-log redaction tests;
- webhook/API token secret-classification policy.

### Done when
Zero active credentials originate from tracked legacy material; repository/history secret scans have no unresolved high/critical active-secret finding.

---

# Phase B — Canonical platform foundation

## EP-02 — Workspace/bootstrap baseline

### Status
IMPLEMENTED BASELINE; hardening continues under EP-11.

### Deliverables
- Node ESM workspace;
- deterministic lockfile;
- lint/type/test/build contracts;
- Postgres/Redis local stack;
- hardened non-root container;
- CI/security baseline;
- `/healthz` and fail-closed `/readyz`;
- sanitized `.env.example`;
- migration framework and schema bootstrap;
- SBOM/provenance generation.

## EP-03 — Contracts + tenant isolation + audit

### Status
MERGED via PR #1; CI green before merge.

### Deliverables
- tenant/account/user/resource identifiers;
- tenant-scoped resource contract;
- fail-closed authorization decision;
- cross-tenant denial guard;
- append-only audit-event contract;
- request/trace correlation identifiers;
- DB row-ownership/RLS policy design;
- negative cross-tenant tests.

### Remaining hardening
- Postgres RLS integration tests;
- actor role/grant semantics;
- audit persistence adapter.

---

# Phase C — Marketplace and affiliate domain

## EP-04 — TikTok Shop adapter parity

### Source donors
`tiktok-shop-sdk` is the primary TypeScript contract donor; `tiktokshop-php` is the parity oracle for PHP-only behavior.

### Deliverables
- canonical `packages/tiktok-shop` adapter;
- canonical request signer and timestamp handling;
- OAuth authorization and token refresh lifecycle;
- token persistence interface with encryption boundary;
- typed client and normalized error model;
- timeout/retry/backoff/circuit-breaker policy;
- pagination contract;
- idempotency key support for mutating calls where possible;
- webhook HMAC/signature validation;
- webhook timestamp/replay-window enforcement;
- deduplication/event-id store interface;
- Affiliate Creator/Partner/Seller APIs;
- Products, Orders, Finance, Fulfillment, Logistics, Promotions, Returns/Refunds, Analytics and Seller APIs;
- endpoint parity matrix TS vs PHP vs canonical;
- sandbox/fixture contract tests.

### Done when
All required endpoints are represented in the parity matrix; every PHP-only required behavior is ported or explicitly retired with rationale; signer/webhook/replay/token tests are green.

## EP-05 — Affiliate domain core

### Deliverables
- tenant-scoped accounts and connected marketplace identities;
- campaigns;
- creators/influencers;
- sellers/partners;
- products/offers;
- affiliate/deep links and sub-ID generation;
- attribution touchpoints;
- conversion/orders/commission records;
- normalized cross-platform identifiers;
- commission and true-margin model;
- immutable monetary/value snapshots;
- analytics query model;
- domain events and audit emission;
- transactional outbox.

### Done when
Core lifecycle `product -> offer -> link -> click -> conversion -> commission -> margin` is testable end-to-end with tenant isolation.

## EP-05B — Additional marketplace/channel adapters

### Deliverables
- Shopee adapter;
- Lazada adapter;
- Facebook/Instagram publishing adapter boundary;
- YouTube publishing adapter boundary;
- LINE OA messaging adapter boundary;
- uniform adapter capability discovery;
- provider-specific rate-limit policy and error normalization.

### Done when
Adapters obey the same tenant/secret/idempotency/audit contracts and can be disabled without breaking the core.

---

# Phase D — Growth automation and workflow engine

## EP-06 — Outreach and creator CRM

### Source donor
`tiktok-shop-bot` provides dedupe/template/quiet-hour/send-budget semantics, but its missing `src.utils` dependency must not be copied.

### Deliverables
- creator/contact CRM;
- consent state;
- suppression/unsubscribe state;
- deterministic dedupe;
- template/version system;
- quiet hours and per-channel budgets;
- provider-neutral email/DM interface;
- durable transactional outbox;
- send-attempt lifecycle;
- bounded retry and DLQ;
- follow-up scheduler semantics;
- delivery/reply/conversion attribution;
- CLI as a thin authenticated API client;
- anti-spam/platform-policy guardrails.

### Done when
A campaign can safely produce approved outreach, persist it, deliver idempotently, retry safely and prove suppression/consent enforcement.

## EP-07 — Durable jobs, approvals and agent workflow

### Deliverables
- job states: queued/running/waiting_approval/succeeded/failed/cancelled;
- durable idempotency records;
- queue adapter and workers;
- retry budgets and DLQ;
- cancellation semantics;
- mutation approval authority;
- actor/tenant/action/resource binding;
- approval expiry/reject/cancel;
- replay prevention;
- tool grants and policy engine;
- trace/audit propagation;
- reconciliation workers.

### Done when
Mutating provider operations cannot execute without valid policy/approval when required and duplicate/replayed jobs cannot duplicate external effects.

## EP-08 — Identity, authorization, billing and entitlements

### Deliverables
- user/session lifecycle;
- secure passwordless/OIDC-ready identity boundary;
- RBAC + tenant-aware ABAC;
- service identities;
- API keys scoped by tenant/action;
- plan and entitlement model;
- usage meters;
- quotas and rate plans;
- immutable double-entry/reconcilable billing ledger design;
- invoice/payment-provider boundary;
- admin bootstrap disabled after provisioning;
- privilege escalation audit.

### Done when
Tenant/account access, quotas and billable actions are deterministic, auditable and reconciliation-safe.

## EP-09 — AI content and optimization plane

### Deliverables
- provider-neutral LLM/image/video/voice interfaces;
- prompt/template versioning;
- deterministic request provenance;
- provider/model fallback policy;
- spend/cost budgets;
- usage metering;
- cache policy;
- safety/moderation boundary;
- tool invocation policy;
- product-research agent;
- offer-ranking agent;
- copy/script agent;
- image/video brief agent;
- publisher agent;
- conversion-analysis agent;
- affiliate-optimizer agent;
- experiment/bandit interface;
- human approval for high-risk/mutating workflows.

### Done when
Generated assets are provenance-traceable, budgeted, reviewable and can never receive marketplace/provider secrets client-side.

---

# Phase E — Product UI and analytics

## EP-10 — Web + admin control plane

### Deliverables
- tenant/workspace switcher;
- onboarding;
- connect/disconnect marketplace accounts;
- product/offer discovery;
- campaigns;
- creators/CRM;
- affiliate link builder;
- content studio;
- publishing calendar;
- outreach center;
- workflow/job/approval center;
- attribution funnel;
- commissions/margin dashboard;
- billing/usage;
- audit log;
- incident/security surfaces;
- operator/admin console;
- responsive/accessibility baseline;
- strict server-side secret boundary;
- no privileged provider credentials in browser bundles.

### Done when
All core affiliate workflows can be completed through the control plane with authorization and audit evidence.

## EP-10B — Analytics + attribution intelligence

### Deliverables
- impression/click/cart/order/conversion model;
- sub-ID/UTM/deep-link attribution;
- multi-touch attribution interface;
- creative/campaign/product performance dimensions;
- commission/margin reconciliation;
- cohort/funnel views;
- anomaly detection hooks;
- export/API boundary;
- event-quality and late-arrival handling.

---

# Phase F — Enterprise production readiness

## EP-11 — Full production validation

### Quality gates
- lint/format/type/build;
- unit tests;
- integration tests;
- Postgres RLS negative tests;
- adapter contract tests;
- end-to-end tests;
- webhook replay/idempotency tests;
- load tests;
- soak tests;
- fault injection: DB/Redis/queue/provider/AI outage;
- backup/restore drills;
- migration/reconciliation tests.

### Security gates
- SAST;
- SCA/dependency audit;
- secret scanning including history evidence;
- container scanning;
- IaC scanning;
- SBOM;
- provenance/attestation;
- threat model review;
- authz/tenant isolation test matrix;
- SSRF/URL validation for outbound connectors;
- webhook HMAC/replay validation;
- CSP/security headers for web UI.

### Reliability/operations gates
- structured logs;
- metrics;
- traces;
- SLO/SLI definitions;
- alert rules;
- dashboards;
- error budgets;
- on-call runbooks;
- capacity model;
- disaster recovery runbook;
- RPO/RTO declaration;
- upgrade/rollback procedure.

### Done when
No unresolved critical/high release blocker; all release-required CI checks green; backup/restore evidence exists; production-readiness checklist signed off.

## EP-11B — Supply-chain and release engineering

### Deliverables
- semantic versioning;
- changelog automation;
- deterministic builds;
- signed release tag/commit in trusted local GPG environment;
- SBOM attached to release;
- artifact/container provenance;
- immutable release manifest;
- rollback artifact retention;
- release candidate promotion workflow.

---

# Phase G — Migration and final release

## EP-12 — Data migration + reversible cutover

### Deliverables
- source data inventory;
- transformation mappings;
- idempotent migrations;
- dry runs;
- count/checksum/business-total reconciliation;
- shadow reads/events where feasible;
- freeze legacy mutations;
- final delta sync;
- progressive traffic enablement;
- reversible routing;
- webhook reconciliation;
- commission/billing reconciliation;
- post-cutover SLO watch.

### Done when
Canonical production is authoritative and a tested rollback remains possible without losing or duplicating mutations.

## EP-12B — Final release

### Deliverables
- release candidate validation;
- final security review;
- final performance/load evidence;
- final migration reconciliation;
- release notes;
- signed release evidence from trusted local Git/GPG environment;
- production deployment;
- post-release smoke/e2e;
- immutable release baseline.

### Done when
Production release is healthy, reconciled and documented with zero unresolved release blocker.

## EP-13 — Legacy retirement

### Stage 1: archive
- freeze/archive all seven legacy repositories;
- preserve mirror/bundle/SHA manifests;
- retain final HEAD/tag/ref inventory;
- update links to canonical repository;
- perform restore drill from retired artifacts.

### Stage 2: observation
- run archive observation window;
- verify no runtime/build/deployment dependency on legacy repos;
- verify canonical production stability and reconciliation.

### Stage 3: permanent deletion
Permanent deletion is allowed only after every hard gate is green and explicit owner approval is recorded immediately before deletion.

---

# Mandatory PR evidence

Every PR must contain:
1. scope and acceptance criteria;
2. source repository/ref provenance;
3. migration-ledger rows affected;
4. tests executed and results;
5. security impact/threat considerations;
6. API/schema/data compatibility impact;
7. telemetry/alerts added or changed;
8. rollback procedure;
9. unresolved gaps/risks;
10. exact CI run evidence before merge.

# Merge policy

- Never merge red CI.
- Never interpret missing checks as green checks.
- Never bypass tenant/security/secret/reconciliation gates to accelerate delivery.
- Prefer one bounded vertical slice per PR.
- Squash merge implementation slices unless preserved commit topology is specifically required.

# Stop-the-line conditions

Stop cutover/retirement on any of:
- secret exposure;
- cross-tenant access failure;
- authorization bypass;
- ledger/reconciliation mismatch;
- lost or duplicate external mutation;
- webhook replay/reconciliation failure;
- broken backup/restore;
- unresolved critical/high security finding;
- red required CI;
- undocumented/unclassified legacy blob;
- inability to roll back.

# Completion definition

The project is COMPLETE only when EP-00 through EP-13 are evidence-complete, `zaffiliate` is the sole production runtime, final release gates are green, backups/restores are verified, and legacy repositories have completed the approved retirement procedure. Documentation alone is never sufficient evidence of completion.
