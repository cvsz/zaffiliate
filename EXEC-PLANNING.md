# zaffiliate Master Execution Planning

Updated: 2026-08-25 · Single canonical source. This file is the merged execution plan: mission, EP-00..EP-13 phase definitions and historical completion record, operating policies, the requirement-vs-repository mapping, and all evidence-backed slice records. The former separate lowercase `exec-planning.md` variant was absorbed here and removed; references across README, CONTRIBUTING, docs/, CI gates, and PR template point to this file.

## Mission

Consolidate `cvsz/zaffhub`, `cvsz/ztsaff`, `cvsz/tiktok-shop-bot`, `cvsz/tiktok-shop-sdk`, `cvsz/tiktokshop-php`, `cvsz/zlttbots`, and `cvsz/zttlbots` into one canonical enterprise-grade affiliate-commerce platform: `cvsz/zaffiliate`.

The final system must be production-ready, multi-tenant, auditable, reversible, secure by default, observable, idempotent, testable and operable without relying on any legacy repository at runtime.

## Execution contract

Work proceeds as bounded vertical slices. Every implementation slice must include: production code, contracts/schema/migrations where applicable, automated tests, security review, telemetry/observability impact, rollback method, source-provenance evidence and CI evidence. No legacy repository may be permanently deleted during an implementation slice.

A slice is not DONE merely because files exist. DONE means its acceptance criteria are evidenced. Every item carries: Title · Priority · Status (`TODO|IN_PROGRESS|BLOCKED|VERIFYING|COMPLETE|DEFERRED`) · Dependencies · Owner · Scope · Non-goals · Acceptance Criteria · Tests · Security · Observability · Documentation · Verification Evidence. COMPLETE requires recorded evidence (test output, gate output). Security failures fail closed. One bounded item per execution turn; report then stop.

Priority model: P0 foundations/security/data · P1 commercial MVP · P2 automation+analytics · P3 intelligence+optimization · P4 scale/production. Dependency order overrides numbering.

## Operating policies

### Mandatory PR evidence

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

### Merge policy

- Never merge red CI.
- Never interpret missing checks as green checks.
- Never bypass tenant/security/secret/reconciliation gates to accelerate delivery.
- Prefer one bounded vertical slice per PR.
- Squash merge implementation slices unless preserved commit topology is specifically required.

### Stop-the-line conditions

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

### Completion definition

The project is COMPLETE only when EP-00 through EP-13 are evidence-complete, `zaffiliate` is the sole production runtime, final release gates are green, backups/restores are verified, and legacy repositories have completed the approved retirement procedure. Documentation alone is never sufficient evidence of completion.

## Historical baseline — EP phases and completion record

Recorded 2026-08-22 after the full-slice implementation pass (233 deterministic tests green, `npm run check` clean across all modules):

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
- Still open and NOT fabricable locally: legacy credential rotation (EP-01 — runbook at `docs/closure/ep01-credential-rotation.md`), live-infrastructure load/soak/fault-injection and backup drills against production data (EP-11 — execution plan at `docs/closure/ep11-production-execution.md`), maintainer GPG-signed attestations (EP-11B — runbook at `docs/closure/ep11b-gpg-attestation.md`), reversible production cutover (EP-12), final release (EP-12B), legacy retirement (EP-13 — runbook at `docs/closure/ep12-13-cutover-retirement.md`). Master closure checklist and execution order at `docs/closure/README.md` and `docs/closure/execution-plan.md`.

### Phase definitions (acceptance criteria source)

#### Phase A — Migration integrity and security closure

**EP-00 — 100% migration ledger + history preservation.** Deliverables: enumerate every blob from each pinned legacy snapshot; row schema `source_repo`, `source_ref`, `path`, `blob_sha`, `size`, `class`, `action`, `canonical_destination`, `reason`, `validation`; classes PORT, REWRITE, REFERENCE, DROP-GENERATED, DROP-UNRELATED, QUARANTINE-SECRET; detect duplicate content across repositories; inventory branches/tags/releases/issues/PRs required as provenance; `git clone --mirror` backups for all seven repositories; `git bundle --all` artifacts verified; SHA-256 all backups/manifests; clean-room restore drill and ref comparison. Done when: 100% of source blobs are classified with no unresolved path; backup manifests are immutable; restore drill reproduces required refs.

**EP-01 — Legacy secret incident closure.** Deliverables: rotate/revoke every credential potentially derived from tracked `ztsaff` runtime secret material; scan current trees and complete history for all seven repositories; credential-rotation evidence without storing secrets; prohibit tracked runtime `.env` material via `.gitignore`, CI policy and repository conventions; server-side secret-manager adapter contract; structured-log redaction tests; webhook/API token secret-classification policy. Done when: zero active credentials originate from tracked legacy material; repository/history secret scans have no unresolved high/critical active-secret finding.

#### Phase B — Canonical platform foundation

**EP-02 — Workspace/bootstrap baseline.** IMPLEMENTED BASELINE; hardening continues under EP-11. Node ESM workspace; deterministic lockfile; lint/type/test/build contracts; Postgres/Redis local stack; hardened non-root container; CI/security baseline; `/healthz` and fail-closed `/readyz`; sanitized `.env.example`; migration framework and schema bootstrap; SBOM/provenance generation.

**EP-03 — Contracts + tenant isolation + audit.** MERGED via PR #1; CI green before merge. Tenant/account/user/resource identifiers; tenant-scoped resource contract; fail-closed authorization decision; cross-tenant denial guard; append-only audit-event contract; request/trace correlation identifiers; DB row-ownership/RLS policy design; negative cross-tenant tests. Remaining hardening was completed per the record above (RLS integration tests, grants semantics, audit persistence adapter).

#### Phase C — Marketplace and affiliate domain

**EP-04 — TikTok Shop adapter parity.** Source donors: `tiktok-shop-sdk` (primary TypeScript contract donor); `tiktokshop-php` (parity oracle for PHP-only behavior). Canonical `packages/tiktok-shop` adapter; canonical request signer and timestamp handling; OAuth authorization and token refresh lifecycle; token persistence interface with encryption boundary; typed client and normalized error model; timeout/retry/backoff/circuit-breaker policy; pagination contract; idempotency key support for mutating calls where possible; webhook HMAC/signature validation; timestamp/replay-window enforcement; deduplication/event-id store interface; Affiliate Creator/Partner/Seller APIs; Products, Orders, Finance, Fulfillment, Logistics, Promotions, Returns/Refunds, Analytics and Seller APIs; endpoint parity matrix TS vs PHP vs canonical; sandbox/fixture contract tests. Done when: all required endpoints represented in the parity matrix; every PHP-only required behavior ported or explicitly retired with rationale; signer/webhook/replay/token tests green.

**EP-05 — Affiliate domain core.** Tenant-scoped accounts and connected marketplace identities; campaigns; creators/influencers; sellers/partners; products/offers; affiliate/deep links and sub-ID generation; attribution touchpoints; conversion/orders/commission records; normalized cross-platform identifiers; commission and true-margin model; immutable monetary/value snapshots; analytics query model; domain events and audit emission; transactional outbox. Done when: core lifecycle `product -> offer -> link -> click -> conversion -> commission -> margin` is testable end-to-end with tenant isolation.

**EP-05B — Additional marketplace/channel adapters.** Shopee adapter; Lazada adapter; Facebook/Instagram publishing adapter boundary; YouTube publishing adapter boundary; LINE OA messaging adapter boundary; uniform adapter capability discovery; provider-specific rate-limit policy and error normalization. Done when: adapters obey the same tenant/secret/idempotency/audit contracts and can be disabled without breaking the core.

#### Phase D — Growth automation and workflow engine

**EP-06 — Outreach and creator CRM.** Source donor: `tiktok-shop-bot` provides dedupe/template/quiet-hour/send-budget semantics, but its missing `src.utils` dependency must not be copied. Creator/contact CRM; consent state; suppression/unsubscribe state; deterministic dedupe; template/version system; quiet hours and per-channel budgets; provider-neutral email/DM interface; durable transactional outbox; send-attempt lifecycle; bounded retry and DLQ; follow-up scheduler semantics; delivery/reply/conversion attribution; CLI as thin authenticated API client; anti-spam/platform-policy guardrails. Done when: a campaign can safely produce approved outreach, persist it, deliver idempotently, retry safely and prove suppression/consent enforcement.

**EP-07 — Durable jobs, approvals and agent workflow.** Job states queued/running/waiting_approval/succeeded/failed/cancelled; durable idempotency records; queue adapter and workers; retry budgets and DLQ; cancellation semantics; mutation approval authority; actor/tenant/action/resource binding; approval expiry/reject/cancel; replay prevention; tool grants and policy engine; trace/audit propagation; reconciliation workers. Done when: mutating provider operations cannot execute without valid policy/approval when required and duplicate/replayed jobs cannot duplicate external effects.

**EP-08 — Identity, authorization, billing and entitlements.** User/session lifecycle; secure passwordless/OIDC-ready identity boundary; RBAC + tenant-aware ABAC; service identities; API keys scoped by tenant/action; plan and entitlement model; usage meters; quotas and rate plans; immutable double-entry/reconcilable billing ledger design; invoice/payment-provider boundary; admin bootstrap disabled after provisioning; privilege escalation audit. Done when: tenant/account access, quotas and billable actions are deterministic, auditable and reconciliation-safe.

**EP-09 — AI content and optimization plane.** Provider-neutral LLM/image/video/voice interfaces; prompt/template versioning; deterministic request provenance; provider/model fallback policy; spend/cost budgets; usage metering; cache policy; safety/moderation boundary; tool invocation policy; product-research agent; offer-ranking agent; copy/script agent; image/video brief agent; publisher agent; conversion-analysis agent; affiliate-optimizer agent; experiment/bandit interface; human approval for high-risk/mutating workflows. Done when: generated assets are provenance-traceable, budgeted, reviewable and can never receive marketplace/provider secrets client-side.

#### Phase E — Product UI and analytics

**EP-10 — Web + admin control plane.** Tenant/workspace switcher; onboarding; connect/disconnect marketplace accounts; product/offer discovery; campaigns; creators/CRM; affiliate link builder; content studio; publishing calendar; outreach center; workflow/job/approval center; attribution funnel; commissions/margin dashboard; billing/usage; audit log; incident/security surfaces; operator/admin console; responsive/accessibility baseline; strict server-side secret boundary; no privileged provider credentials in browser bundles. Done when: all core affiliate workflows can be completed through the control plane with authorization and audit evidence.

**EP-10B — Analytics + attribution intelligence.** Impression/click/cart/order/conversion model; sub-ID/UTM/deep-link attribution; multi-touch attribution interface; creative/campaign/product performance dimensions; commission/margin reconciliation; cohort/funnel views; anomaly detection hooks; export/API boundary; event-quality and late-arrival handling.

#### Phase F — Enterprise production readiness

**EP-11 — Full production validation.** Quality gates: lint/format/type/build; unit/integration tests; Postgres RLS negative tests; adapter contract tests; e2e tests; webhook replay/idempotency tests; load tests; soak tests; fault injection (DB/Redis/queue/provider/AI outage); backup/restore drills; migration/reconciliation tests. Security gates: SAST; SCA/dependency audit; secret scanning including history evidence; container scanning; IaC scanning; SBOM; provenance/attestation; threat model review; authz/tenant isolation test matrix; SSRF/URL validation for outbound connectors; webhook HMAC/replay validation; CSP/security headers for web UI. Reliability/operations gates: structured logs; metrics; traces; SLO/SLI definitions; alert rules; dashboards; error budgets; on-call runbooks; capacity model; disaster recovery runbook; RPO/RTO declaration; upgrade/rollback procedure. Done when: no unresolved critical/high release blocker; all release-required CI checks green; backup/restore evidence exists; production-readiness checklist signed off.

**EP-11B — Supply-chain and release engineering.** Semantic versioning; changelog automation; deterministic builds; signed release tag/commit in trusted local GPG environment; SBOM attached to release; artifact/container provenance; immutable release manifest; rollback artifact retention; release candidate promotion workflow.

#### Phase G — Migration and final release

**EP-12 — Data migration + reversible cutover.** Source data inventory; transformation mappings; idempotent migrations; dry runs; count/checksum/business-total reconciliation; shadow reads/events where feasible; freeze legacy mutations; final delta sync; progressive traffic enablement; reversible routing; webhook reconciliation; commission/billing reconciliation; post-cutover SLO watch. Done when: canonical production is authoritative and a tested rollback remains possible without losing or duplicating mutations.

**EP-12B — Final release.** Release candidate validation; final security review; final performance/load evidence; final migration reconciliation; release notes; signed release evidence from trusted local Git/GPG environment; production deployment; post-release smoke/e2e; immutable release baseline. Done when: production release is healthy, reconciled and documented with zero unresolved release blocker.

**EP-13 — Legacy retirement.** Stage 1 archive: freeze/archive all seven legacy repositories; preserve mirror/bundle/SHA manifests; retain final HEAD/tag/ref inventory; update links to canonical repository; perform restore drill from retired artifacts. Stage 2 observation: run archive observation window; verify no runtime/build/deployment dependency on legacy repos; verify canonical production stability and reconciliation. Stage 3 permanent deletion: allowed only after every hard gate is green and explicit owner approval is recorded immediately before deletion.

## Master mapping — requirement vs repository

Classification: COMPLETE · PARTIAL · MISSING · OBSOLETE · BLOCKED(+reason). Action: reuse / extend / migrate / new.

### P0 platform foundation

| Item | Requirement | Existing implementation | Coverage | Action |
|---|---|---|---|---|
| AFF-001 Repository assessment | inventory | `IMPLEMENTATION-CHECKLIST.md` gap matrix | COMPLETE | reuse |
| AFF-002 Architecture baseline | docs | `ARCHITECTURE.md`, `docs/PROVIDER-CAPABILITY-MATRIX.md` | COMPLETE | extend |
| AFF-003 Monorepo/workspace | layout | single-package ESM monorepo, zero-dep policy (`CONTRIBUTING.md`) | COMPLETE (adapted) | reuse |
| AFF-004 Configuration system | env config | `packages/config` typed validation (enums, URLs, ports, secret lengths, production requirements), `.env.example`, fail-fast `ConfigError` wired into `buildServer` | COMPLETE | reuse |
| AFF-005 PostgreSQL foundation | app-level DB access | compose service, CI psql RLS job; **no app client** | PARTIAL | extend → `packages/db` (next task) |
| AFF-006 Database migrations | programmatic migrator | 3 SQL migrations applied by CI shell only | PARTIAL | extend → migrator w/ drift detection |
| AFF-007 Authentication | authn | sessions + SHA-256 API keys (`identity-billing`); OAuth browser flow absent | PARTIAL | extend (AFF-033/MM-004) |
| AFF-008 Organizations/tenancy | isolation | tenant equality + Postgres RLS tested | COMPLETE | reuse |
| AFF-009 RBAC | roles/grants | `grants.js` role-rank + escalation audit; merged role set in `schema.js` | COMPLETE | reuse |
| AFF-010 Audit logging | tamper-evident | SHA-256 hash chain (`audit.js`) | COMPLETE | reuse |
| AFF-011 Secret management | ref-only | `ref:` manager + classification + redaction | COMPLETE | reuse |
| AFF-012 Redis | cache/bus | compose service only; no app usage | MISSING (runtime) | new → MM-005 |
| AFF-013 Job queue | durable jobs | workflow runtime (claims/retry/DLQ/approvals) | PARTIAL | extend |
| AFF-014 Object storage | media assets | none | MISSING | new (AFF-014) |
| AFF-015 Event contracts | domain events | outbox events in runtimes; typed bus absent | PARTIAL | extend (MM-005) |
| AFF-016 API conventions | routing style | `/api/v1/version` + canonical error envelope on unknown routes; domain-route envelope migration pending | PARTIAL | extend |
| AFF-017 Error model | consistent codes | `{error:{code,message,request_id}}` envelope introduced; domain routes still legacy shape | PARTIAL | extend (next) |
| AFF-018 Input validation | schema layer | `contracts/schema.js` + per-module validators | COMPLETE | reuse |
| AFF-019 Observability | logs/metrics/traces/SLO | structured logger w/ redaction, MetricsRegistry, `/metrics`, SLO eval, alert/dashboard configs | COMPLETE | reuse |
| AFF-020 Security baseline | controls | transport-boundary, SSRF validator, rate-limit, CSP web | COMPLETE | reuse |
| AFF-021 Threat model | documented | `THREAT-MODEL.md` w/ register + residuals | COMPLETE | maintain |
| AFF-022 CI | hardened pipeline | 9-job workflow incl. RLS, container, scans, release evidence | COMPLETE | reuse |
| AFF-023 Dependency security | audit | `npm audit --audit-level=high` gate; single pinned dep | COMPLETE | maintain |
| AFF-024 Secret scanning | fail-closed scan | gitleaks-or-grep gate | COMPLETE | maintain |
| AFF-025 SAST | static analysis | audit+secrets only; semgrep placeholder | PARTIAL | extend |
| AFF-026 Container security | non-root + scan | Dockerfile non-root asserted; trivy fallback | COMPLETE | maintain |
| AFF-027 SBOM | generation | `scripts/generate-sbom.mjs` + attestation | COMPLETE | reuse |
| AFF-028 Compose dev env | one-command stack | hardened `compose.yaml` (PG+Redis+API) | COMPLETE | reuse |
| AFF-029 Backup/restore baseline | drill | `scripts/backup-restore-drill.mjs` in CI | COMPLETE | reuse |
| AFF-030 Documentation baseline | docs set | README/ARCHITECTURE/ROADMAP/SECURITY/THREAT-MODEL/COMPLIANCE/PRIVACY/CONTRIBUTING/CHANGELOG/CHECKLIST | COMPLETE | maintain |

### P0 integration foundation

| Item | Existing | Coverage | Action |
|---|---|---|---|
| AFF-031 Provider abstraction | adapter manifests + signed clients (tiktok/shopee/lazada/publishing boundary) | PARTIAL | extend |
| AFF-032 Capability registry | `provider-registry.js`: AVAILABLE/APPROVAL_REQUIRED/MANUAL/UNSUPPORTED/TEMPORARILY_DISABLED | COMPLETE | reuse |
| AFF-033 OAuth framework | external identity links only; no browser OAuth/OIDC | MISSING | new (MM-004) |
| AFF-034 Encrypted credential storage | `ref:` secret manager; provider tokens not yet stored | PARTIAL | extend |
| AFF-035 Token refresh | none | MISSING | new (after AFF-033) |
| AFF-036 Webhook framework | `/webhooks/:platform` ingress live | PARTIAL | extend |
| AFF-037 Signature verification | TikTok canonical + generic HMAC, timing-safe | COMPLETE | reuse |
| AFF-038 Replay protection | replay guard + event dedupe store | COMPLETE | reuse |
| AFF-039 Rate-limit handling | token bucket (`rate-limit.js`) | COMPLETE | reuse |
| AFF-040 Retry policies | resilience pkg (timeout/retry/breaker) in tiktok-shop | PARTIAL | generalize |
| AFF-041 Circuit breakers | same resilience pkg | PARTIAL | generalize |
| AFF-042 Integration health | `/readyz`, supabase health; per-provider health absent | PARTIAL | extend |
| AFF-043 Contract tests | sandbox/mocked tiktok suites | PARTIAL | extend per provider |

### P1 affiliate domain

Merchants/products/offers/links/clicks/conversions/commissions lifecycle: **COMPLETE** in `affiliate-core` (immutable minor-unit snapshots, outbox, idempotent orders). Gaps: product variants/promotions/refunds/payouts models MISSING (extend `schema.js` + runtime); catalog ingestion/normalization/dedup/sync MISSING (needs adapters+queue); safe redirect + click tracking **COMPLETE** (MM-002); payout model MISSING.

### P1 platform adapters

TikTok: capability discovery via manifests ✓, SDK complete ✓, publishing boundary ✓ (AFF-070..073 largely COMPLETE). Shopee/Lazada signed clients ✓, conversion ingestion via webhook ✓ (AFF-080..083 PARTIAL→catalog reads need creds: BLOCKED-on-credentials for live verification). Meta/YouTube: publishing boundary only; OAuth/capability discovery/analytics MISSING (AFF-090..104). Provider Verification Rule: live capability verification BLOCKED until sandbox credentials are provisioned; no endpoint invented meanwhile.

### P1 campaign / AI foundation / content engine / image & video factory / variation

Campaign model+lifecycle: PARTIAL (status machine in `schema.js`; planner/budget/audience/brand-voice MISSING). AI abstraction: PARTIAL (`ai-content` LLM/image/video/voice interfaces, fallback, budgets, provenance hashes, moderation boundary — moderation/embedding providers and usage accounting persistence PARTIAL; prompt registry/versioning COMPLETE). Content engine generators (hook/script/caption/CTA/hashtags/SEO/disclosure; Thai/English): PARTIAL — template-driven runtime exists, dedicated generator surfaces MISSING; claims validation via provenance grounding PARTIAL. Image factory: MISSING beyond interface (DEFERRED until storage+providers). Video factory: DEFERRED (interfaces only; FFmpeg pipeline planned AFF-170..185). Creative lineage: PARTIAL (provenance fields in `ContentItemSchema`, bandit variants; parent/child lineage MISSING).

### P1 approval / publishing / calendar

Approval: workflow approvals w/ TTL fail-closed expiry + web approve endpoint + audit — COMPLETE core; high-risk policy routing PARTIAL. Publishing: PublicationJob contract on 9-state machine ✓; scheduler/idempotent publish/retry/DLQ/reconciliation live inside workflow engine PARTIAL; unified publication_jobs persistence pending MM-003. Calendar API/UI: MISSING (control-plane has nav/audit/billing/workflow/outreach/analytics surfaces).

### P2 attribution / analytics / mission control / trend & opportunity / automation engine

Attribution: click→conversion chain + reconciliation tolerance COMPLETE core; impression/engagement events, attribution windows/confidence MISSING. Analytics metrics: runtime computes CTR/CVR/EPC-class aggregates PARTIAL; full metric suite + ROI family MISSING. Mission control dashboards: PARTIAL (existing JSON surfaces + config dashboards); failure center/approval queue UI MISSING. Trend intelligence: MISSING. Opportunity scoring: MISSING. Automation policies: workflow grant/policy engine COMPLETE core; discovery/ranking/generation automation MISSING.

### P3 experimentation / learning / autonomous optimization / agents

Experimentation: seeded bandit selection + min-sample winner gating (contract-enforced) PARTIAL; statistical analysis/winner workflow TODO. Learning engine/feature store: MISSING. Autonomous optimization: MISSING (policies must route through approval + capability states). Agent orchestration: seven canonical agents + tool grants + budgets in ai-content/workflow PARTIAL; typed agent task contracts + registry MISSING.

### P4 scale / production ops / supply chain

Workers/scheduler apps: MISSING (stub-class). Queue partitioning/read replicas/warehouse/streaming/CDN/multi-region: MISSING (defer by design). SLI/SLO: SLO evaluation + alert configs COMPLETE baseline; incident/runbooks partial (`OPERATIONS.md`). Load/soak/fault-inject scripts COMPLETE. Supply chain: pinning ✓, SBOM ✓, signing/attestation ✓ (gpg), Dependabot config MISSING, CodeQL MISSING (semgrep placeholder noted).

### Milestones vs repo reality

M0 Secure Foundation: ~90% (missing: app DB client [in progress], Redis bus, storage). M1 Affiliate MVP: ~80% (campaign planner + content generators partial). M2 Content Factory: deferred (media). M3 Publisher: ~60% (TikTok/Shopee strong; Meta/YT thin). M4 Revenue Intelligence: ~70%. M5–M7: open.

## Completed slice records (evidence-backed)

### GM-002 — Durable publication jobs (B3 closure) — Status: COMPLETE
Scope: migration `005_publication_jobs.sql` (9-state table, idempotency uniqueness, retry CHECKs, dispatch index, RLS FORCE+policy) + `packages/db/src/publication-jobs-repo.js` (canonical transition map fail-closed w/ PublicationTransitionError, optimistic status guard, retry budget on failed/partial reprocessing, idempotent create returning existing job, skip-locked exactly-once claimDue honoring scheduled_for/next_retry_at). Restart survival proven: fresh client instance reads, claims exactly once, publishes.
Evidence: publication-jobs suite 8/8 zero-skip LIVE against Supabase PG pooler (migration 005 applied idempotently); full suite 479 tests — 477 pass, 0 fail, 2 gated skips; check clean; audit 0 vulns; security-check PASS. B1 also CLOSED this turn: GM-001 pushed as 531b69d, CI green run 32871141615. RELEASE-READINESS.md updated. Files: db/migrations/005_publication_jobs.sql, packages/db/src/publication-jobs-repo.js, packages/db/src/index.js, test/publication-jobs-repo.test.js, package.json, RELEASE-READINESS.md, IMPLEMENTATION-CHECKLIST.md, CHANGELOG.md.

### GM-001 — Gold-master slice: release blocker fix + RELEASE-READINESS — Status: COMPLETE
Blockers fixed: (1) webhook event-dedupe clock mixing — expiry computed from injected `receivedAt` but checked against wall-clock `Date.now()`, time-bombing duplicate-delivery suppression for frozen/backdated timelines (duplicate-financial-event gate, master-spec §29); store now takes an injectable `now` clock used consistently by seen()/record(), default wall-clock (production call site unchanged). (2) `scripts/migrate-data.mjs` wrote `dist/` outputs without mkdir, ENOENT-crashing CI on fresh checkouts (root cause of red main-branch CI runs since 2026-08-24). Regression tests first: 2 new dedupe/replay-guard cases + webhook replay harness moved onto its frozen clock; RED 3 → GREEN.
Evidence: focused suites green; full `npm test` 471 tests — 470 pass, 0 fail, 1 gated skip; `npm run check` clean; `npm audit --omit=dev --audit-level=high` 0 vulns; `scripts/security-check.sh` PASS. `RELEASE-READINESS.md` created: decision NOT_READY_FOR_GOLD_MASTER, blockers B2..B10 enumerated. Files: packages/tiktok-shop/src/event-dedupe.js, scripts/migrate-data.mjs, test/tiktok-resources.test.js, test/api-business-routes.test.js, RELEASE-READINESS.md, CHANGELOG.md, IMPLEMENTATION-CHECKLIST.md.

### WIRE-002 — Automation control plane + content factory over HTTP — Status: COMPLETE
Routes: GET /api/v1/automation/status · POST kill-switch · PUT policy · POST /api/v1/intelligence/gate (full OPT-004 chain) · GET personas · POST briefs/hooks/score.
Tests: test/features-automation-content.test.js 4 cases RED->GREEN; JWKS suite stabilized w/ injected clock (3 consecutive green runs).
Evidence: full suite 469 tests - 468 pass, 0 fail, 1 gated skip; npm run check clean. Production service restarted post-wiring.

### WIRE-001 — Feature HTTP surfaces — Status: COMPLETE
Routes live (tenant-gated, canonical envelopes): GET /api/v1/commerce/offers · GET /api/v1/intelligence/opportunities/rank (rankAndRecord) · GET /api/v1/intelligence/recommendations · POST .../:id/feedback · GET /api/v1/analytics/overview. Unknown /api/v1 paths keep the 404 envelope; feature paths without tenant header -> 400 TENANT_HEADER_REQUIRED.
Tests: test/features-wiring.test.js 5 cases RED->GREEN.
Evidence: full suite 465 tests - 464 pass, 0 fail, 1 gated skip (one transient flake investigated: gating was over-broad to unknown paths -> scoped to known prefixes).

### DEPLOY-001 — Public deployment at https://zaffiliate.zeaz.dev — Status: COMPLETE
Live chain: Internet -> Cloudflare edge -> dedicated locally-managed tunnel 77107d8b (ingress self-hosted in /etc/cloudflared-zaffiliate/config.yml; connector systemd unit token-mode w/ 600 env file) -> loopback Caddy vhost (:80/:8080, CF real-IP headers) -> API :8788 (APP_ENV=production, APP_ENV gates enforced, secrets root-side /etc/zaffiliate.env 640) -> Supabase Postgres pooler.
Root-caused en route: NAT blocks ALL inbound ports (why siblings use tunnels), remote-managed tunnel ingress not API-editable (10405), systemd EnvironmentFile section placement, cloudflared flag order (--config global before subcommand; --token after run).
Ops artifact: scripts/deploy-host.sh now provisions api+tunnel+edge+migrations idempotently.
Verification: external healthz 200 {"ok":true,"service":"zaffiliate-api"}; version endpoint appEnv=production. zeaz tf change signed f1264a3 pushed.

### MM-003-lite — Durable analytics_events persistence (live end-to-end) — Status: COMPLETE
Scope: `packages/db/src/analytics-repo.js` (awaited multi-row parameterized inserts of canonical envelopes w/ lineage+payload folded into dimensions jsonb; app-level dedupe pre-insert; async listRecent mapping); migration `004_canonical_analytics_types.sql` (replaced legacy 6-value CHECK with the canonical 17-type set — real schema drift resolved via the migrator itself).
LIVE EVIDENCE (Supabase node.b pooler): tenant seeded -> canonical affiliate_click envelope persisted -> readback matched eventId+type. Full chain now durable: ingest -> dedupe -> feature pipeline -> Postgres.
Tests: `test/analytics-repo.test.js` 4 cases RED->GREEN (parameterized multi-row insert shape, empty-batch no-op, pre-database dedupe, async readback mapping).
Evidence: full suite 459 tests - 458 pass, 0 fail, 1 gated skip across two consecutive runs; `npm run check` clean.

### MM-006 completion — SigV4 S3 driver + canonical envelope completion + redis streams — Status: COMPLETE
Scope: `packages/storage/src/s3.js` (zero-dep AWS SigV4: four-stage HMAC schedule, sha256 payload integrity, shared immutable-key validation before network); business-layer error bodies migrated to canonical envelope across all sites; `packages/events/redis-streams.js` XADD publisher w/ memory fallback.
LIVE EVIDENCE: Supabase Postgres migrations applied idempotently via IPv4 pooler (18 RLS tables); integration suite 7/7 zero-skip. Supabase S3 smoke: signature accepted to resource resolution, write returned 403 provider-permission denial -> recorded fail-closed, no bypass.
Tests: storage-s3 (4), events-redis (3), envelope spec (1), db integration now executing against real PG.
Evidence: full suite 455 tests - 454 pass, 0 fail, 1 gated skip; `npm run check` clean.

### MM-004 foundation — JWKS-backed RS256 token verification — Status: COMPLETE
Scope: `packages/security/src/jwks.js`. createJwksClient: injectable-fetch cache (10-min TTL) with once-per-cache-generation forced refresh on unknown kid (self-DoS proof); verifyJwt: RS256-only (alg=none/HS256 structurally rejected), kid-pinned signature via node crypto, exp/nbf/iss/aud checks with timing-safe comparisons, frozen claim/header output, fail-closed reasons for every rejection path.
Tests: `test/security-jwks.test.js` 5 cases RED->GREEN (happy path, tamper, expired/aud/iss matrix, unknown-kid refresh-count contract incl. no-loop assertion, algorithm confusion).
Also completed from the remaining list this turn: canonical envelope migration finished (17/17), redis stream publisher (3/3), live-PG migrator run (applied 001..003 idempotently; 18 RLS tables; integration 7/7 zero-skip).
Evidence: full suite 451 tests - 450 pass, 0 fail, 1 gated skip; `npm run check` clean.

### AFF-017 completion + MM-005 Redis adapter + LIVE POSTGRES INTEGRATION — Status: COMPLETE
Scope: business.js error bodies migrated to the canonical envelope (uppercase codes + messages + request correlation; 18 call sites); `packages/events/redis-streams.js` stream publisher (XADD triples w/ injectable client, memory-ring fallback when ioredis/REDIS_URL absent); db client hardened for managed Postgres (remote TLS + ipv4first DNS); cli/migrator default migrations dir resolved correctly and prefix contract widened to \d{3,4}.
LIVE EVIDENCE (Supabase node.b via IPv4 session pooler): connectivity probe -> 3 migrations applied (`001_core_tenant_rls`, `002_workflow_outreach`, `003_billing_ai_analytics`) -> idempotent re-run skipped all 3 -> **18 public tables, ALL RLS-enabled** -> test/db.test.js integration case executed against real PG with 0 skips (7/7).
Tests: envelope spec added to api-business-routes suite; new `test/events-redis-adapter.test.js` (XADD field triples, memory fallback, validation).
Evidence: full suite 446 tests - 445 pass, 0 fail, 1 gated skip; `npm run check` clean.

### OPT-004 — Autonomous decision gate wiring — Status: COMPLETE
Scope: `packages/intelligence/src/decision-gate.js`. Composes commerce revalidation (BLOCK or ERROR -> DENY w/ blockers; tenant-ambiguous offers fail closed) with the automation policy evaluator (tenant/kill-switch/risk/platform/scores/frequency/budget/mode), emitting combined ALLOW/APPROVAL_REQUIRED/DENY verdicts + audited intelligence.gate_decision events.
Tests: `test/decision-gate.test.js` 8 cases RED->GREEN (full ALLOW path w/ revalidation evidence; stale-price DENY regardless of ranker confidence; global kill switch precedence; APPROVAL_REQUIRED passthrough preserving evidence; cross-tenant denial; capability-platform denial; expired-promotion denial; audit-sink capture).
Evidence: full suite 437 tests - 436 pass, 0 fail, 1 gated skip; `npm run check` clean. OPT backlog complete: intelligence outputs are now structurally incapable of acting outside the policy plane.

### OPT-002/OPT-003 — Experiment recommendation + exploration policy — Status: COMPLETE
Scope: `packages/intelligence/src/optimization.js`. recommendExperiments (LOW-confidence -> CREATE_EXPERIMENT w/ control+challenger variants, hypothesis, 30-sample statistical floor, promotion-window-bounded expiry; settled HIGH-confidence winners excluded); createExplorationPolicy (validated configurable exploreRatio, deterministic slot allocation filling explore slots from TEST-class first, frozen org-provenance outputs).
Tests: `test/intelligence-optimization.test.js` 8 cases RED->GREEN.
Evidence: full suite 429 tests - 428 pass, 0 fail, 1 gated skip; `npm run check` clean.

### MLOPS-007/OPT-001 — Audited rollback + portfolio classification — Status: COMPLETE
Scope: registry rollbackModel (audited model.rollback events w/ actor+reason+previousVersion; refuses ghost targets and no-op rollbacks); `packages/intelligence/src/portfolio.js` classifyPortfolio (deterministic PAUSE/WATCH/TEST/SCALE/MAINTAIN rules over ranker output + drift signals, frozen reasons-carrying entries).
Tests: `test/intelligence-portfolio.test.js` 6 cases RED->GREEN.
Evidence: full suite 421 tests - 420 pass, 0 fail, 1 gated skip; `npm run check` clean.

### MLOPS-005/MLOPS-006 — Model monitoring + drift detection — Status: COMPLETE
Scope: `packages/intelligence/src/drift.js` (baseline-registered numeric feature drift: relative mean shift, configurable WARN/ALERT ratios, min-sample floor returning INSUFFICIENT_DATA, fail-closed unknown features, frozen reports); `packages/intelligence/src/monitoring.js` (ModelMonitor over the existing MetricsRegistry: model_predictions_total/_errors/_latency, feature_stale_total, feature_missing_total).
Tests: `test/mlops-monitoring.test.js` 8 cases RED->GREEN (no-drift identity, ALERT/WARN bands, insufficient-evidence refusal, unknown-feature fail-closed, frozen reports, counter semantics w/ conventional _total-includes-errors alignment, stale/missing separation, tenant-free unit surface).
Evidence: full suite 415 tests - 414 pass, 0 fail, 1 gated skip; `npm run check` clean.

### MLOPS-001/MLOPS-004 — Model registry + shadow comparison — Status: COMPLETE
Scope: `packages/intelligence/src/registry.js` (ModelRegistry: frozen reproducibility metadata, CANDIDATE->VALIDATING->SHADOW->PRODUCTION lifecycle w/ REJECTED terminal + RETIRED preservation, single-production-per-name w/ challenger demotion, approver-required promotion, instant rollback from RETIRED, fail-closed illegal transitions incl. explicit terminal-status messaging); `packages/intelligence/src/shadow.js` (tenant-scoped champion/challenger pairs, agreement rate + mean absolute delta, nulls for empty windows).
Tests: `test/mlops.test.js` 8 cases RED->GREEN (candidate-jump denial, full-path+approver requirement, champion retirement + rollback, rejection terminality, unknown-model fail-closed, pair recording/agreement/MAE, empty-window nulls, tenant scoping).
Evidence: full suite 407 tests - 406 pass, 0 fail, 1 gated skip; `npm run check` clean.

### ML-021/ML-024 — Ranking evaluation framework + explanation layer — Status: COMPLETE
Scope: `packages/intelligence/src/evaluation.js`. evaluateRanking: strict-window top-K hit rate (K=|knownGood| default, clamped; verifiably-bad product in window zeroes credit; unobservable windows score 0), Pearson score-vs-outcome correlation w/ null below 2 paired samples, frozen report. explainRecommendation: structured operator artifact (summary text citing ranker reasons verbatim, confidence, modelVersion, per-feature freshness map, executable flag w/ fail-closed EXPIRED labeling).
Tests: `test/intelligence-evaluation.test.js` 8 cases RED->GREEN (perfect/inverted rankings, monotonic correlation ~1, null-correlation honesty, k clamping, no-outcome zero rule, explanation structure/freshness/expiry).
Evidence: full suite 399 tests - 398 pass, 0 fail, 1 gated skip; `npm run check` clean.

### ML-003/ML-004-wiring/ML-023 — Feature computation + recommendation service — Status: COMPLETE
Scope: `packages/intelligence/src/pipeline.js` (computeOfferFeatures, createRecommendationService); additive `summarizeByProduct` in analytics events store; `list()` on recommendation store. Offer features (discount ratio / inventory / effective price) computed from verified commerce records with computedAt=offer.verifiedAt so stale evidence yields STALE features naturally via the existing freshness gate; per-product engagement features (clicks/CVR/net commission 7d) derived from the deduplicated event stream's lineage; rankAndRecord runs baseline-rules-v1 then persists every entry as a Recommendation and the top candidate as a Prediction — full audit trail through the ML-022 stores.
Tests: `test/intelligence-pipeline.test.js` 5 cases RED->GREEN (typed feature computation from snapshots, stale-evidence->STALE regression, dedup-stream engagement features, auditable rank-and-record w/ top prediction, end-to-end tenant isolation).
Evidence: full suite 391 tests - 390 pass, 0 fail, 1 gated skip; `npm run check` clean.

### ML-005/ML-022 — Dataset versioning + prediction/recommendation stores — Status: COMPLETE
Scope: `packages/intelligence/src/stores.js`. TrainingDatasetStore (immutable reproducibility metadata: labels, validated time range, row count, feature-set versions); PredictionStore (model@version + featuresVersion + confidence tiers + future-only validUntil; latest() excludes expired while history() stays fully queryable); RecommendationStore (ACTIVE lifecycle with single-shot feedback ACCEPTED/REJECTED/MODIFIED/IGNORED; fail-closed coercion of late ACCEPTED to EXPIRED; terminal-state immutability).
Tests: `test/intelligence-stores.test.js` 7 cases RED->GREEN incl. immutability, range inversion rejection, expiry-vs-history separation, expired-accept coercion, cross-tenant isolation across all three stores.
Evidence: full suite 386 tests - 385 pass, 0 fail, 1 gated skip; `npm run check` clean.

### ML-001/002/004/020 — Feature platform foundation + baseline ranker — Status: COMPLETE
Scope: `packages/intelligence/src/index.js`. Versioned immutable FeatureDefinition registry (8 entity types, 3 value types, name@version identity w/ duplicate-first validation); tenant-partitioned FeatureStore with type-enforced writes; freshness resolution FRESH/AGING/STALE/UNKNOWN against configurable windows (stale values withheld + retained separately); baseline-rules-v1 opportunity ranker: expected-net-per-conversion x observed-cvr x discount boost x sample-size confidence weight x promotion factor, hard zero for OUT_OF_STOCK/UNKNOWN inventory, expired-promotion penalty demanding urgency-claim removal, explainable reasons citing actual figures, expiry bounded by promotion window.
Tests: `test/intelligence-features.test.js` 10 cases RED->GREEN (registry immutability/duplicates/malformed shapes, type enforcement, freshness transitions via injected clock, UNKNOWN semantics, cross-tenant isolation, deterministic evidence-backed ordering, inventory sink rules, expired-promotion flagging, tenant scoping).
Evidence: full suite 379 tests - 378 pass, 0 fail, 1 gated skip; `npm run check` clean. Also this turn: GPG-signed commit 152b6bf pushed to origin/main (signature verified Good).

### SEC-005b (CSRF, master-spec §8) — Web mutation gate — Status: COMPLETE
Scope: `apps/web/server.js approveWorkflow` now enforces, in order: custom `x-zaff-csrf: 1` header -> `application/json` content-type -> Origin/host equality when Origin is present. Any failure: 403 csrf_check_failed with zero state mutation. Read routes untouched.
Tests: `test/web-csrf.test.js` 6 cases RED->GREEN (blocked attempt leaves approval pending; wrong content-type; evil-origin rejection; same-origin happy path; headerless non-browser clients allowed; GET neutrality). Legacy approval fixtures updated to carry the header deliberately — they test approval semantics, not the bypass.
Evidence: all four web suites 22/22; full suite 369 tests - 368 pass, 0 fail, 1 gated skip; `npm run check` clean.

### SEC-021/SEC-022 — Ingress rate limiting + security events — Status: COMPLETE
Scope: `packages/security/src/{rate-limit-api,security-events}.js`; wiring in `apps/api/src/server.js` (per tenant+route+address buckets on /go/:slug and /webhooks/:platform; 429 + Retry-After via canonical envelope; RATE_LIMITED + WEBHOOK_SIGNATURE_FAILURE event emission). Reuse note: existing adapters token-bucket is provider-platform-bound, so a keyed general-purpose limiter was added rather than bending that contract.
Tests: `test/security-hardening.test.js` 7 cases (burst/throttle/retry-after, key isolation across tenants+routes, fractional refill math w/ injected clock, construction validation, typed+frozen events, unknown type/severity fail-closed, sink-less counting) + `test/api-security-ingress.test.js` 3 e2e cases (429 regression w/ envelope+request_id echo, cross-tenant non-leak of throttle state, invalid-signature 401 AND recorded MEDIUM event).
Evidence: full suite 363 tests - 362 pass, 0 fail, 1 gated skip; `npm run check` clean.

### UI-001/UI-005/UI-020/UI-021/UI-022 — Mission Control foundation — Status: COMPLETE
Scope: `apps/web/public/tokens.css` (semantic tokens + severity system + light/dark theming); `apps/web/server.js` (+escapeHtml, +buildOverviewPayload, DI dataProviders, /api/ui/overview route, tokens.css asset); `apps/web/public/views.js` (+renderMissionControl registered as the #overview surface: loading skeleton note, error state w/ impact+retry guidance, empty-state action center explaining purpose/action, primary-vs-secondary KPI hierarchy, severity badges with text labels); index.html tokens link + mount section (existing nav contract untouched).
Data posture: no fixtures for KPIs — values come from injected live stores; absent stores render honest zeros flagged in freshness.degraded.
Tests: `test/ui-mission-control.test.js` 6 cases RED->GREEN (tenant gating, zero-state shape w/ exact 6 primary ids, injected-store reflection incl. kill-switch DANGER + expiring-promotion WARNING + reason/recommendedAction presence, provider-failure degradation, token stylesheet contract, escapeHtml stored-XSS regression).
Evidence: full suite 353 tests - 352 pass, 0 fail, 1 gated skip; `npm run check` clean.

### COM-001/002/003/004 + freshness gate — Status: COMPLETE
Scope: `packages/affiliate-core/src/commerce.js`. Offer schema (provider identity, minor-unit pricing w/ sale>list rejection, 5-way inventory enum w/ UNKNOWN never purchasable, commission evidence, source+verifiedAt); append-only immutable PriceSnapshots; Promotion model (11 types, mandatory windows, clock-resolved UPCOMING/ACTIVE/EXPIRING/EXPIRED, UNKNOWN never active); configurable per-claim freshness thresholds; revalidateCommercialClaim ALLOW/BLOCK engine (stale_price / stale_evidence / promotion_expired) with regeneration/removal actions.
Tests: `test/commerce.test.js` 11 cases RED->GREEN incl. tenant isolation (null-offer + cross_tenant_access throw), promotion-expiration regression, stale-price regression, and the golden commercial scenario from the master spec (1000/800 -> verified 20% discount allowed pre-expiry; price move to 850 blocks old creative).
Evidence: full suite 347 tests - 346 pass, 0 fail, 1 gated skip; `npm run check` clean.

### DATA-001/DATA-002/DATA-003 — Canonical event envelope, raw persistence, deduplication — Status: COMPLETE
Scope: `packages/analytics/src/events.js` (extends existing analytics pkg; legacy domain.js untouched). 17-type taxonomy; 7-way source classification enforced at creation; envelope with eventVersion/lineage/correlationId/receivedAt/lateArrivalMs; affiliate clicks require link lineage; deterministic identity via provider+external_event_id with sha256 payload-fingerprint fallback (order-independent); append-only immutable tenant-partitioned raw store; semantic summarize with documented formulas (CTR/CVR/net-commission floor/EPC) excluding pending commission from net.
Tests: `test/analytics-events.test.js` 12 cases RED->GREEN incl. duplicate-delivery regression, order-independent fingerprint dedup, immutability, cross-tenant isolation, pending-vs-net separation, negative-revenue floor, and the golden dataset from the master spec (100 impressions / 20 clicks / 4 conversions -> CTR 20%, CVR 20%, net 1500 minor units, EPC 75).
Evidence: full suite 336 tests - 335 pass, 0 fail, 1 gated skip; `npm run check` clean.

### AUTO-001/AUTO-002/AUTO-003/AUTO-007 — Automation policy plane — Status: COMPLETE
Scope: `packages/automation/src/index.js`. Versioned frozen AutomationPolicy (mode enum manual/assisted/draft_only/approval_required/auto_safe/autonomous; platform/category allowlists; per-day + per-platform caps; daily/campaign AI budgets in minor units; quality/compliance floors; pre-approved content classes; capability flags defaulting fail-closed). Typed AutomationDecision {ALLOW|APPROVAL_REQUIRED|MANUAL_REQUIRED|DENY|DEFER, reason, requiredApprover, checks[], policyVersion, dryRun}. Evaluator check chain: tenant -> kill switches -> risk routing (critical DENY / high specialist) -> platform -> score floors -> frequency (DEFER) -> budgets (daily DENY / campaign approval) -> mode semantics -> final. Kill switches at six scopes w/ reasons, no-deployment activation, inspectable registry. Audit events appended for EVERY decision incl. denials. dryRun marks zero-effect decisions.
Non-goals: shadow mode (AUTO-008), durable workflow state (AUTO-005), trigger engine, publishing integration.
Tests: `test/automation-policy.test.js` 17 cases RED->GREEN covering DENY/ALLOW/APPROVAL/MANUAL_REQUIRED/DEFER behavior, tenant isolation, kill-switch scoping + regression after deactivation, audit-on-denial, dry-run.
Evidence: full suite 324 tests - 323 pass, 0 fail, 1 gated skip; `npm run check` clean.

### AFF-143/AFF-170/AFF-171 — Script generator + storyboard engine — Status: COMPLETE
Scope: `packages/ai-content/src/factory.js` additions. generateScript: 9 formats (15s/30s/60s short, tutorial, comparison, review-style, ugc-style, storytelling, educational) with exact duration budgets; canonical section order hook->problem->insight->solution->demo->[social-proof]->cta->disclosure as timestamped scenes; top-scored compliant hook from the existing hook engine; insight/demo grounded in benefit+evidence pairs; social proof included ONLY when substantiated via evidence-referenced entries (validated at brief creation), otherwise omitted with recorded reason; disclosure scene verbatim from brief. createStoryboard: aspect validation (9:16/1:1/4:5/16:9), deterministic visual mapping per scene label, duration labels + seconds summing to the script budget, editable flag, lineage (storyboardId->scriptId->briefId), fail-closed on broken timestamps. PROMPT_REGISTRY extended with script-generator@v1 and storyboard@v1.
Tests: `test/content-factory.test.js` grown to 19 cases RED->GREEN (registry exposure, format fail-closed, exact-budget timestamps, structure order, unsubstantiated-proof omission reason, verbatim disclosure, subtitle-caption invariant, storyboard derivation + lineage + corrupt-timestamp refusal).
Evidence: full suite 307 tests - 306 pass, 0 fail, 1 gated skip; `npm run check` clean.

### AFF-005/AFF-006 — Application DB client + programmatic migrator — Status: COMPLETE
**Title:** `packages/db` — pooled Postgres client (lazy `pg` import) + checksummed, drift-detecting migrator over existing `db/migrations/*.sql`
**Priority:** P0 · **Dependencies:** none unmet (migrations already exist; compose provides PG) · **Owner:** principal engineer (autonomous session)
**Scope:** `packages/db/src/{client,migrator,index}.js`; `test/db.test.js`; dependency `pg` (exact-pinned, justified: official pure-JS driver; CI already audits it).
**Non-goals:** rewiring runtimes to repos (next task), Redis, ORM/query-builder, new migrations.
**Acceptance Criteria:**
- [x] Migrator lists local migrations sorted with sha256 checksums
- [x] Plans pending/applied/driven-drift states from `schema_migrations`
- [x] Applies each pending migration in its own transaction, records checksum, idempotent on re-run
- [x] Refuses (fail-closed) to apply when applied checksums diverge from files (drift)
- [x] Client lazily connects, exposes query/transaction/check, never logs credentials
**Tests:** [x] Unit (driver-fake, deterministic) · [x] Integration (real PG, auto-skips when DATABASE_URL unreachable) · [x] Security (drift fail-closed; no secret leakage in errors)
**Security:** parameterized queries only; migration files read-only input; drift refusal prevents tampered-schema continuation; connection string never logged/redacted via logger.
**Observability:** migrator emits structured log events via injected logger; client.check() reports reachability for /readyz extension.
**Documentation:** CHANGELOG entry; CHECKLIST row update; ARCHITECTURE data-layer section; THREAT-MODEL residual refresh.
**Verification Evidence:** 2026-08-24 — `test/db.test.js` 6 pass + 1 environment-gated integration skip (no local PG; CI postgres job covers it). Full suite `npm test` 277 tests: 276 pass, 0 fail, 1 skip. `npm run check` clean including new modules. Drift fail-closed proven (checksum mismatch → MigrationDriftError with zero migration/data statements executed); transaction-per-migration + checksum bookkeeping verified via statement recording; connection credentials verified absent from `check()` output. Dependency added: `pg@ pinned-exact` (justified: official pure-JS Postgres driver; audited by existing CI gate).

### AFF-004/016/017 bootstrap slice — Status: COMPLETE
Canonical error envelopes, redis stream adapter, live Postgres integration groundwork; see MM-006/AFF-017 records above for the completed continuation.

### AFF-MM-001 — Capability states + normalized contracts — Status: COMPLETE
Evidence: `npm test` 270/270 includes 10 capability + 14 schema tests; `npm run check` clean. Files: `packages/adapters/src/provider-registry.js`, `packages/contracts/src/schema.js`. (Merged from former EXEC-PLANNING.md MM-001 record.)

### AFF-MM-002 — Safe redirect + webhook ingress — Status: COMPLETE
Evidence: 13 tests in `test/api-business-routes.test.js` (signature-fail-closed, replay dedupe, stale-window reject, cross-tenant 404, tampered destination 404); full suite 270/270; check clean. Files: `apps/api/src/business.js`, `apps/api/src/server.js`, `packages/affiliate-core/src/runtime.js`. (Merged from former EXEC-PLANNING.md MM-002 record.)

## Current task

GM-B5 — restore-into-clean-environment rehearsal + per-migration rollback classification — IN PROGRESS (real pg_dump of live Supabase captured; isolated postgres:17 target restored; verifier battery surfaced two findings being fixed: `tenants` table missing FORCE+policy → migration 006; verifier must exercise RLS via non-owner app role due to superuser BYPASSRLS semantics). Merge of EXEC-PLANNING.md into this file completed this turn.

## Next bounded item

Complete GM-B5: apply migration 006, rework restore-rehearsal verifier to provision and use a dedicated app role, re-run full rehearsal (restore → schema/tenant/financial/golden checks), document per-migration rollback classification in db/migrations/ROLLBACK.md, record evidence in RELEASE-READINESS.md.

## Backlog (dependency-ordered)

Redis streams bus w/ graceful degradation · OAuth/OIDC browser flow + account recovery + token refresh · object storage adapter · error-model/API-conventions consolidation · product variant/promotion/refund/payout contracts · per-provider contract-test expansion · semgrep/CodeQL + Dependabot · calendar API · attribution windows/confidence · trend/opportunity engines · image factory (post-storage) · video factory (FFmpeg, post-storage) · workers/scheduler apps · k8s/helm packaging · versioned provider policy registry (MM-007) · creator-studio surfaces (MM-008) · trend/opportunity scoring (MM-009).

## Deviation notes

- Prompt's `docs/` tree tracked as backlog documentation task; existing flat doc set + `docs/*` subdirs retained until content justifies restructuring.
- Live-provider verification (Provider Verification Rule steps 1–10) BLOCKED on credentials; recorded as such instead of inventing capabilities.
- 2026-08-25: the two planning files (`EXEC-PLANNING.md` historical + `exec-planning.md` canonical) were merged, briefly consolidated under the lowercase name, then restored to this uppercase filename as the single source; references updated repo-wide (README, CONTRIBUTING, IMPLEMENTATION-CHECKLIST, RELEASE-READINESS, docs/closure, docs/migration, PR template, ci.yml existence gate).
