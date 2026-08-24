# zaffiliate Master Execution Planning

Updated: 2026-08-22

## Mission

Consolidate `cvsz/zaffhub`, `cvsz/ztsaff`, `cvsz/tiktok-shop-bot`, `cvsz/tiktok-shop-sdk`, `cvsz/tiktokshop-php`, `cvsz/zlttbots`, and `cvsz/zttlbots` into one canonical enterprise-grade affiliate-commerce platform: `cvsz/zaffiliate`.

The final system must be production-ready, multi-tenant, auditable, reversible, secure by default, observable, idempotent, testable and operable without relying on any legacy repository at runtime.

## Execution contract

Work proceeds as bounded vertical slices. Every implementation slice must include: production code, contracts/schema/migrations where applicable, automated tests, security review, telemetry/observability impact, rollback method, source-provenance evidence and CI evidence. No legacy repository may be permanently deleted during an implementation slice.

A slice is not DONE merely because files exist. DONE means its acceptance criteria are evidenced.

## Current state

Updated 2026-08-22 after the full-slice implementation pass (233 deterministic tests green, `npm run check` clean across all modules):

- EP-02 bootstrap baseline: implemented on `main` (workspace, API health/readiness, tests, CI definition, Docker/Compose, Postgres/Redis baseline).
- EP-03 tenant-isolation/audit contract: merged through PR #1; hardening delivered — Postgres RLS integration tests in CI (`db/tests/*`), actor role/grant semantics (`packages/contracts/src/grants.js`), append-only hash-chained audit persistence adapter (`packages/contracts/src/audit.js`).
- EP-04 TikTok Shop parity: canonical resource adapters for all 14 groups, resilience (timeout/retry/breaker), cursor pagination, mandatory mutation idempotency keys, webhook replay guard + event dedupe store; parity matrix rows set to `complete` (`docs/parity/TIKTOK-SHOP-PARITY.md`).
- EP-05 affiliate lifecycle runtime: tenant-partitioned product -> offer -> link -> click -> conversion -> commission -> margin with immutable minor-unit snapshots, idempotent conversions on orderRef, domain events + transactional outbox, audit sink.
- EP-05B adapter boundary: Shopee/Lazada signed clients, Facebook/Instagram/YouTube publishing boundary (approval + idempotency + credential-reference enforcement), LINE consent-suppressed messaging, token-bucket rate-limit policy and provider error normalization.
- EP-06 outreach runtime: contact CRM, consent/suppression, deterministic dedupe, quiet hours, per-channel budgets and hourly guardrails, bounded retry -> DLQ, follow-up scheduler with no_reply condition, delivery/reply/conversion attribution, outbox emission.
- EP-07 workflow runtime: tool grants/policy engine, atomic claims, replay-proof idempotent enqueue, backoff retries -> dead-letter queue, two-phase running cancellation, bound approvals with TTL fail-closed expiry, stale-running reconciliation once-only, ordered outbox.
- EP-08 identity/billing runtime: sessions + OIDC-ready external identity links, service identities, SHA-256-hashed action-scoped API keys, plan entitlements with fail-closed quota meters, balanced double-entry ledger + reconciliation, invoices with partial payments, permanent admin-bootstrap lock, privilege-escalation audit log.
- EP-09 AI content runtime: provider-neutral LLM/image/video/voice interfaces with fallback, prompt template versioning + provenance hashes, spend budgets enforced pre-call, moderation boundary, cache policy, seven canonical agents, publisher human approval gate, seeded bandit experiments.
- EP-10 control plane web: all core surfaces rendered CSP-first (no inline script/style), hardened static serving (traversal-safe), tenant-header-gated JSON APIs for navigation/audit/billing/workflow/outreach/analytics, approval decision endpoint; zero privileged credentials in browser payloads (reference pointers only).
- EP-10B analytics runtime: typed funnel ingestion with late/future arrival windows and event-id idempotency, last/first/linear attribution with exact integer credit distribution, dimension performance, cohort funnels, anomaly rules, deterministic JSON/CSV export boundary, commission reconciliation.
- EP-01 leftovers closed in code: server-side secret-manager contract, deep structured-log redaction (denylist + pattern scrubbing), secret-classification policy matrix, observability plane (structured logs via redactor, metrics/spans/correlation, SLO evaluation) under `packages/security` and `packages/observability`.
- EP-11 end-to-end smoke harness: `test/e2e.test.js` exercising API + web surfaces with cross-origin isolation check; `docs/operations/e2e-runbook.md`.
- EP-11 alert rules + dashboards: 12 alert rule definitions (`config/alerts.json`) covering SLO, latency, queue depth, dead-letter, cross-tenant, webhook replay, ledger delta; 15 dashboard panels (`config/dashboards.json`) for Overview/SLO/Workflow/Security/Infrastructure; runbooks in `docs/operations/alerts.md` and `docs/operations/dashboards.md`.
- EP-01 credential rotation evidence template: `docs/migration/credential-rotation-evidence.md` with SHA-256 evidence recording procedure, sign-off template, and stop-the-line conditions.
- EP-11 threat model: `docs/security/threat-model.md` formal STRIDE analysis, trust boundaries, data-flow description, attack trees for webhook replay, cross-tenant access, secret leakage, approval bypass.
- EP-11 CI security scanning jobs: `.github/workflows/ci.yml` added `sast`, `secret-scan`, `container-scan`, `iac-scan` jobs with fail-closed guards and conditional fallbacks for optional tooling (gitleaks, trivy, checkov).
- EP-11 production validation harnesses: load/soak/fault-injection/backup-restore drill scripts + runbooks; CI integration job `validation-harnesses`; SSRF/URL validation tests for outbound connectors; production-readiness checklist; RPO/RTO declaration; capacity model; upgrade/rollback procedure.
- EP-11B release engineering: semver engine, conventional-commit changelog automation, deterministic release manifest pipeline, GPG attestation workflow + maintainer runbook, CycloneDX SBOM generator, release CI workflow template.
- EP-12/12B/13 migration + cutover + retirement: idempotent data migrator with dry-run and SHA-256 reconciliation, progressive cutover simulator (dry-run/shadow/enable/rollback), post-cutover SLO watch, release candidate validation, post-release smoke test, reconciliation tooling for commissions/billing/webhooks, retirement runbook with archive/observation/deletion stages.
- EP-03 hardening: Postgres RLS integration tests in CI (`db/tests/*`), actor role/grant semantics (`packages/contracts/src/grants.js`), append-only hash-chained audit persistence adapter (`packages/contracts/src/audit.js`).
- Still open and NOT fabricable locally: legacy credential rotation (EP-01 — runbook at `docs/closure/ep01-credential-rotation.md`), live-infrastructure load/soak/fault-injection and backup drills against production data (EP-11 — execution plan at `docs/closure/ep11-production-execution.md`), maintainer GPG-signed attestations (EP-11B — runbook at `docs/closure/ep11b-gpg-attestation.md`), reversible production cutover (EP-12), final release (EP-12B), legacy retirement (EP-13 — runbook at `docs/closure/ep12-13-cutover-retirement.md`). Master closure checklist and execution order at `docs/closure/README.md` and `docs/closure/execution-plan.md`.

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

# Master-meta alignment pass (2026-08-23)

## MM-001 — Provider capability states + normalized domain contracts

- ID: MM-001
- Priority: P0
- Status: COMPLETE (evidence below)
- Dependencies: none
- Scope: `packages/adapters/src/provider-registry.js` (capability availability states: available / approval_required / manual / unsupported / temporarily_disabled; fail-closed defaults; approval-id gate for mutating ops); `packages/contracts/src/schema.js` (normalized domain model + zero-dep validator); master-meta required docs (THREAT-MODEL, COMPLIANCE, IMPLEMENTATION-CHECKLIST, CHANGELOG, PRIVACY, CONTRIBUTING, docs/PROVIDER-CAPABILITY-MATRIX).
- Non-goals: live provider calls, persistence rewiring, OAuth browser flow, redirect endpoint.
- Acceptance criteria: capability decisions enumerable per provider for dashboards; mutating ops blocked without approval id; manual ops never automatable; unknown capabilities unsupported; domain entities validate with explicit issue paths.
- Tests: `test/provider-capability.test.js` (10), `test/domain-schema.test.js` (14) — RED then GREEN.
- Security requirements: fail-closed semantics; secrets remain server-only at construction; no browser automation path expressible.
- Documentation changes: files listed above; `npm run check` extended.
- Evidence: `npm test` 257/257 pass; `npm run check` clean. Also fixed pre-existing time-bomb in `test/identity-billing.test.js` (expiry assertions now pin clock).

## MM-002 (next) — Public link redirect + webhook ingress routes

- ID: MM-002 · Priority: P1 · Status: TODO · Dependencies: MM-001 (contracts)
- Scope: expose `/go/:slug` redirect with attribution event + HTTPS/open-redirect guards, and multi-platform webhook ingest endpoint reusing tiktok-shop replay/dedupe machinery, both backed by existing affiliate-core runtime and audit chain.
- Non-goals: Postgres rewiring, new adapters.
- Acceptance criteria: e2e tests prove click recorded → redirect issued → webhook deduped → conversion idempotent; cross-tenant slugs denied; non-HTTPS targets rejected.

## Backlog (priority order)

MM-003 runtimes→Postgres behind dev/prod toggle · MM-004 OAuth/OIDC browser flow + account recovery · MM-005 Redis streams bus w/ graceful degradation · MM-006 storage adapter package · MM-007 versioned provider policy registry (restrictions/disclosures/rate limits/last_verified_at) · MM-008 creator-studio surfaces on control plane · MM-009 trend/opportunity scoring engine · MM-010 k8s/helm packaging.

## MM-002 — Public link redirect + webhook ingress

- ID: MM-002
- Title: `/go/:slug` attribution redirect and multi-platform signed webhook ingest
- Priority: P1
- Status: COMPLETE (evidence below)
- Dependencies: MM-001 (contracts), affiliate-core runtime
- Scope: `apps/api/src/business.js` (pure decision layer: `resolveRedirect`, `ingestWebhook`); server wiring in `apps/api/src/server.js` (`GET /go/:slug`, `POST /webhooks/:platform`); additive runtime extensions in `packages/affiliate-core/src/runtime.js` (link `slug`+`expiresAt`, `resolveLinkBySlug`/`resolveLinkById`/`findLinkBySubId`, optional hashed `visitorHash` on click touchpoints).
- Non-goals: persistence rewiring, new adapters, OAuth, storage.
- Acceptance criteria: slug redirect issues 302 to HTTPS deep link after recording an attribution event; unknown and foreign-tenant slugs indistinguishable 404; expired links 410; corrupted destinations fail closed; webhooks require valid HMAC (canonical TikTok scheme for tiktok) before any state change; replay guard dedupes within window and rejects stale timestamps; conversions idempotent by orderRef.
- Tests: `test/api-business-routes.test.js` (13, RED→GREEN).
- Security requirements: tenant header gate on both routes (fail-closed 404); timing-safe signature compare; secrets only via `ref:` manager; 1 MiB body cap; no payload-controlled redirects (stored, re-validated HTTPS targets only); privacy-conscious visitor hash (salted SHA-256 of ip+ua, never raw).
- Documentation changes: CHANGELOG, IMPLEMENTATION-CHECKLIST, THREAT-MODEL residual update.
- Evidence: `npm test` 270/270 pass; `npm run check` clean including new modules.

## MM-003 (next) — Runtimes → Postgres behind dev/prod toggle

- ID: MM-003 · Priority: P0 · Status: TODO · Dependencies: MM-001/MM-002 contracts stable
- Scope: port zaff db client/migrator pattern as JS `packages/db`; apply existing `db/migrations/*.sql`; inject repo-backed stores into affiliate-core/workflow/outreach behind a persistence toggle (in-memory default for dev/tests).
- Non-goals: Redis streams bus (MM-005), OAuth (MM-004).
- Acceptance criteria: integration tests run against Postgres when DATABASE_URL is reachable and skip cleanly otherwise; runtime API unchanged for consumers; RLS tests stay green.
