# zaffiliate Master Execution Planning

Updated: 2026-08-24 · Canonical execution source (supersedes `EXEC-PLANNING.md`, retained as historical EP-02..EP-13 record).

## Execution contract

Every item carries: Title · Priority · Status (`TODO|IN_PROGRESS|BLOCKED|VERIFYING|COMPLETE|DEFERRED`) · Dependencies · Owner · Scope · Non-goals · Acceptance Criteria · Tests · Security · Observability · Documentation · Verification Evidence.
COMPLETE requires recorded evidence (test output, gate output). Security failures fail closed. One bounded item per execution turn; report then stop.

Priority model: P0 foundations/security/data · P1 commercial MVP · P2 automation+analytics · P3 intelligence+optimization · P4 scale/production. Dependency order overrides numbering.

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

### AFF-MM-001 — Capability states + normalized contracts — Status: COMPLETE
Evidence: `npm test` 270/270 includes 10 capability + 14 schema tests; `npm run check` clean. Files: `packages/adapters/src/provider-registry.js`, `packages/contracts/src/schema.js`.

### AFF-MM-002 — Safe redirect + webhook ingress — Status: COMPLETE
Evidence: 13 tests in `test/api-business-routes.test.js` (signature-fail-closed, replay dedupe, stale-window reject, cross-tenant 404, tampered destination 404); full suite 270/270; check clean. Files: `apps/api/src/business.js`, `apps/api/src/server.js`, `packages/affiliate-core/src/runtime.js`.

## Current task — COMPLETE this turn

### SEC-005b (CSRF, master-spec §8) — Web mutation gate — Status: COMPLETE
Scope: `apps/web/server.js approveWorkflow` now enforces, in order: custom `x-zaff-csrf: 1` header -> `application/json` content-type -> Origin/host equality when Origin is present. Any failure: 403 csrf_check_failed with zero state mutation. Read routes untouched.
Tests: `test/web-csrf.test.js` 6 cases RED->GREEN (blocked attempt leaves approval pending; wrong content-type; evil-origin rejection; same-origin happy path; headerless non-browser clients allowed; GET neutrality). Legacy approval fixtures updated to carry the header deliberately — they test approval semantics, not the bypass.
Evidence: all four web suites 22/22; full suite 369 tests - 368 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### SEC-021/SEC-022 — Ingress rate limiting + security events — Status: COMPLETE
Scope: `packages/security/src/{rate-limit-api,security-events}.js`; wiring in `apps/api/src/server.js` (per tenant+route+address buckets on /go/:slug and /webhooks/:platform; 429 + Retry-After via canonical envelope; RATE_LIMITED + WEBHOOK_SIGNATURE_FAILURE event emission). Reuse note: existing adapters token-bucket is provider-platform-bound, so a keyed general-purpose limiter was added rather than bending that contract.
Tests: `test/security-hardening.test.js` 7 cases (burst/throttle/retry-after, key isolation across tenants+routes, fractional refill math w/ injected clock, construction validation, typed+frozen events, unknown type/severity fail-closed, sink-less counting) + `test/api-security-ingress.test.js` 3 e2e cases (429 regression w/ envelope+request_id echo, cross-tenant non-leak of throttle state, invalid-signature 401 AND recorded MEDIUM event).
Evidence: full suite 363 tests - 362 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### UI-001/UI-005/UI-020/UI-021/UI-022 — Mission Control foundation — Status: COMPLETE
Scope: `apps/web/public/tokens.css` (semantic tokens + severity system + light/dark theming); `apps/web/server.js` (+escapeHtml, +buildOverviewPayload, DI dataProviders, /api/ui/overview route, tokens.css asset); `apps/web/public/views.js` (+renderMissionControl registered as the #overview surface: loading skeleton note, error state w/ impact+retry guidance, empty-state action center explaining purpose/action, primary-vs-secondary KPI hierarchy, severity badges with text labels); index.html tokens link + mount section (existing nav contract untouched).
Data posture: no fixtures for KPIs — values come from injected live stores; absent stores render honest zeros flagged in freshness.degraded.
Tests: `test/ui-mission-control.test.js` 6 cases RED->GREEN (tenant gating, zero-state shape w/ exact 6 primary ids, injected-store reflection incl. kill-switch DANGER + expiring-promotion WARNING + reason/recommendedAction presence, provider-failure degradation, token stylesheet contract, escapeHtml stored-XSS regression).
Evidence: full suite 353 tests - 352 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### COM-001/002/003/004 + freshness gate — Status: COMPLETE
Scope: `packages/affiliate-core/src/commerce.js`. Offer schema (provider identity, minor-unit pricing w/ sale>list rejection, 5-way inventory enum w/ UNKNOWN never purchasable, commission evidence, source+verifiedAt); append-only immutable PriceSnapshots; Promotion model (11 types, mandatory windows, clock-resolved UPCOMING/ACTIVE/EXPIRING/EXPIRED, UNKNOWN never active); configurable per-claim freshness thresholds; revalidateCommercialClaim ALLOW/BLOCK engine (stale_price / stale_evidence / promotion_expired) with regeneration/removal actions.
Tests: `test/commerce.test.js` 11 cases RED->GREEN incl. tenant isolation (null-offer + cross_tenant_access throw), promotion-expiration regression, stale-price regression, and the golden commercial scenario from the master spec (1000/800 -> verified 20% discount allowed pre-expiry; price move to 850 blocks old creative).
Evidence: full suite 347 tests - 346 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### DATA-001/DATA-002/DATA-003 — Canonical event envelope, raw persistence, deduplication — Status: COMPLETE
Scope: `packages/analytics/src/events.js` (extends existing analytics pkg; legacy domain.js untouched). 17-type taxonomy; 7-way source classification enforced at creation; envelope with eventVersion/lineage/correlationId/receivedAt/lateArrivalMs; affiliate clicks require link lineage; deterministic identity via provider+external_event_id with sha256 payload-fingerprint fallback (order-independent); append-only immutable tenant-partitioned raw store; semantic summarize with documented formulas (CTR/CVR/net-commission floor/EPC) excluding pending commission from net.
Tests: `test/analytics-events.test.js` 12 cases RED->GREEN incl. duplicate-delivery regression, order-independent fingerprint dedup, immutability, cross-tenant isolation, pending-vs-net separation, negative-revenue floor, and the golden dataset from the master spec (100 impressions / 20 clicks / 4 conversions -> CTR 20%, CVR 20%, net 1500 minor units, EPC 75).
Evidence: full suite 336 tests - 335 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### AUTO-001/AUTO-002/AUTO-003/AUTO-007 — Automation policy plane — Status: COMPLETE
Scope: `packages/automation/src/index.js`. Versioned frozen AutomationPolicy (mode enum manual/assisted/draft_only/approval_required/auto_safe/autonomous; platform/category allowlists; per-day + per-platform caps; daily/campaign AI budgets in minor units; quality/compliance floors; pre-approved content classes; capability flags defaulting fail-closed). Typed AutomationDecision {ALLOW|APPROVAL_REQUIRED|MANUAL_REQUIRED|DENY|DEFER, reason, requiredApprover, checks[], policyVersion, dryRun}. Evaluator check chain: tenant -> kill switches -> risk routing (critical DENY / high specialist) -> platform -> score floors -> frequency (DEFER) -> budgets (daily DENY / campaign approval) -> mode semantics -> final. Kill switches at six scopes w/ reasons, no-deployment activation, inspectable registry. Audit events appended for EVERY decision incl. denials. dryRun marks zero-effect decisions.
Non-goals: shadow mode (AUTO-008), durable workflow state (AUTO-005), trigger engine, publishing integration.
Tests: `test/automation-policy.test.js` 17 cases RED->GREEN covering DENY/ALLOW/APPROVAL/MANUAL_REQUIRED/DEFER behavior, tenant isolation, kill-switch scoping + regression after deactivation, audit-on-denial, dry-run.
Evidence: full suite 324 tests - 323 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — COMPLETE this turn

### AFF-143/AFF-170/AFF-171 — Script generator + storyboard engine — Status: COMPLETE
Scope: `packages/ai-content/src/factory.js` additions. generateScript: 9 formats (15s/30s/60s short, tutorial, comparison, review-style, ugc-style, storytelling, educational) with exact duration budgets; canonical section order hook->problem->insight->solution->demo->[social-proof]->cta->disclosure as timestamped scenes; top-scored compliant hook from the existing hook engine; insight/demo grounded in benefit+evidence pairs; social proof included ONLY when substantiated via evidence-referenced entries (validated at brief creation), otherwise omitted with recorded reason; disclosure scene verbatim from brief. createStoryboard: aspect validation (9:16/1:1/4:5/16:9), deterministic visual mapping per scene label, duration labels + seconds summing to the script budget, editable flag, lineage (storyboardId->scriptId->briefId), fail-closed on broken timestamps. PROMPT_REGISTRY extended with script-generator@v1 and storyboard@v1.
Tests: `test/content-factory.test.js` grown to 19 cases RED->GREEN (registry exposure, format fail-closed, exact-budget timestamps, structure order, unsubstantiated-proof omission reason, verbatim disclosure, subtitle-caption invariant, storyboard derivation + lineage + corrupt-timestamp refusal).
Evidence: full suite 307 tests - 306 pass, 0 fail, 1 gated skip; `npm run check` clean.

## Prior task — COMPLETE — IN PROGRESS this turn

### AFF-005/AFF-006 — Application DB client + programmatic migrator

**Title:** `packages/db` — pooled Postgres client (lazy `pg` import) + checksummed, drift-detecting migrator over existing `db/migrations/*.sql`
**Priority:** P0
**Status:** COMPLETE
**Dependencies:** none unmet (migrations already exist; compose provides PG)
**Owner:** principal engineer (autonomous session)
**Scope:** `packages/db/src/{client,migrator,index}.js`; `test/db.test.js`; dependency `pg` (exact-pinned, justified: official pure-JS driver; CI already audits it).
**Non-goals:** rewiring runtimes to repos (next task), Redis, ORM/query-builder, new migrations.
**Acceptance Criteria:**
- [x] Migrator lists local migrations sorted with sha256 checksums
- [x] Plans pending/applied/driven-drift states from `schema_migrations`
- [x] Applies each pending migration in its own transaction, records checksum, idempotent on re-run
- [x] Refuses (fail-closed) to apply when applied checksums diverge from files (drift)
- [x] Client lazily connects, exposes query/transaction/check, never logs credentials
**Tests:** [x] Unit (driver-fake, deterministic) · [x] Integration (real PG, auto-skips when DATABASE_URL unreachable) · [x] Security (drift fail-closed; no secret leakage in errors) · [ ] E2E (n/a)
**Security:** parameterized queries only; migration files read-only input; drift refusal prevents tampered-schema continuation; connection string never logged/redacted via logger.
**Observability:** migrator emits structured log events via injected logger; client.check() reports reachability for /readyz extension.
**Documentation:** CHANGELOG entry; CHECKLIST row update; ARCHITECTURE data-layer section; THREAT-MODEL residual refresh.
**Verification Evidence:** 2026-08-24 — `test/db.test.js` 6 pass + 1 environment-gated integration skip (no local PG; CI postgres job covers it). Full suite `npm test` 277 tests: 276 pass, 0 fail, 1 skip. `npm run check` clean including new modules. Drift fail-closed proven (checksum mismatch → MigrationDriftError with zero migration/data statements executed); transaction-per-migration + checksum bookkeeping verified via statement recording; connection credentials verified absent from `check()` output. Dependency added: `pg@ pinned-exact` (justified: official pure-JS Postgres driver; audited by existing CI gate).

## Current task — COMPLETE this turn

AFF-005/AFF-006 — see record above.

## Next bounded item

**AFF-013/AFF-210 (wiring)** — inject repo-backed stores into `affiliate-core` behind an in-memory-dev/Postgres-prod toggle, reusing `packages/db` + existing migrations; e2e proves redirect→click→webhook→conversion persisted. Depends on AFF-005/006 COMPLETE.

## Backlog (dependency-ordered)

Redis streams bus w/ graceful degradation · OAuth/OIDC browser flow + account recovery + token refresh · object storage adapter · error-model/API-conventions consolidation · product variant/promotion/refund/payout contracts · per-provider contract-test expansion · semgrep/CodeQL + Dependabot · publication_jobs persistence + calendar API · attribution windows/confidence · trend/opportunity engines · image factory (post-storage) · video factory (FFmpeg, post-storage) · workers/scheduler apps · k8s/helm packaging.

## Deviation notes

- Prompt's `docs/` tree tracked as backlog documentation task; existing flat doc set + `docs/*` subdirs retained until content justifies restructuring.
- Live-provider verification (Provider Verification Rule steps 1–10) BLOCKED on credentials; recorded as such instead of inventing capabilities.
