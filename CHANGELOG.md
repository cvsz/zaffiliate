# Changelog

All notable changes to zaffiliate. Format: Keep a Changelog. Versions are attested via `scripts/release-candidate.mjs`.

## [Unreleased]

### Added
- Provider capability-state abstraction (`packages/adapters/src/provider-registry.js`): canonical states `available`, `approval_required`, `manual`, `unsupported`, `temporarily_disabled`; mutating operations fail closed until an approval id is presented; manual operations can never be automated; registry fails closed for unconfigured providers. 10 tests in `test/provider-capability.test.js`.
- Normalized domain model with zero-dependency schema validation (`packages/contracts/src/schema.js`): merchants, products, offers (percentage ≤ 100), campaigns + explicit transition map, affiliate links (HTTPS-only, DNS-safe slugs), clicks, conversions (non-negative money), content items with generation provenance, publication jobs on the 9-state orchestration machine, experiments with min-sample winner gating, approval requests with decision/decider coupling, webhook events, hash-chained audit events, memberships across the merged role set. 14 tests in `test/domain-schema.test.js`.
- Documentation set per master-meta spec: THREAT-MODEL.md, COMPLIANCE.md, IMPLEMENTATION-CHECKLIST.md, docs/PROVIDER-CAPABILITY-MATRIX.md, PRIVACY.md, CONTRIBUTING.md.
- Syntax-check gate extended to all new modules (`npm run check`).

### Fixed
- Time-bomb in `test/identity-billing.test.js`: API-key expiry assertions relied on wall-clock time passing `2026-08-23T00:00:00Z`; clocked assertions now pass explicit `now`.
- Environment: restored missing `node_modules` install for declared `@supabase/supabase-js` dependency (6 suites failed without it).

### Verification
- `npm test`: 257/257 pass (was 251/257 at slice start: 24 new + time-bomb fix; 6 pre-existing env failures resolved by install).
- `npm run check`: clean across all modules including new ones.

### Added (MM-002 — 2026-08-24)

- Public affiliate redirect endpoint `GET /go/:slug`: resolves tenant-scoped links by slug, re-validates stored HTTPS destinations (fail-closed against corrupted/tampered targets), answers 410 for expired links, records a click attribution event with a salted SHA-256 visitor hash (raw IP/UA never persisted), then 302s to the deep link. Tenant header gate returns indistinguishable 404s.
- Multi-platform webhook ingress `POST /webhooks/:platform`: capability-gated platform allowlist; canonical TikTok signature verification; generic HMAC-SHA256 (`sha256=<hex>` over `<timestamp>.<body>`) with timing-safe comparison for all other platforms; replay guard + event dedupe; idempotent conversion ingestion keyed by orderRef; 401 before any state change on bad signatures; 1 MiB body cap.
- Affiliate-core runtime additions: unique slugs + expiry timestamps on links; null-safe lookups by slug/id/subId; optional hex-validated visitor hash on click touchpoints.

### Verification (MM-002)

- `npm test`: 270/270 pass (13 new). `npm run check`: clean. Security controls exercised by tests: bad-signature 401 with zero state change, duplicate delivery 200/deduped single conversion, stale timestamp 400, cross-tenant slug 404, javascript:-scheme destination 404.

### Added (AFF-005/006 — 2026-08-24)

- `packages/db`: pooled Postgres client (lazy `pg` import, exact-pinned dependency; query/transaction/check API; credentials never surfaced in errors or check output) and a checksummed migrator over the existing `db/migrations/*.sql` — sorted listing, pending/applied/drift planning against `schema_migrations`, per-migration transactions that unwrap file-level BEGIN/COMMIT wrappers to keep schema change + checksum record atomic, and fail-closed refusal under checksum drift.
- Canonical lowercase `exec-planning.md` adopted as execution source (full AFF mapping vs repository; supersedes uppercase historical record).

### Verification (AFF-005/006)

- `npm test`: 277 tests — 276 pass, 0 fail, 1 gated skip. `npm run check`: clean. New dependency covered by existing `npm audit --omit=dev --audit-level=high` gate.

### Added (AFF-004/016/017 bootstrap slice — 2026-08-24)

- `packages/config`: canonical typed environment validation — APP_ENV enum, port range, per-service URL scheme checks, 32-char secret floors, production-required variables; fails fast with issue paths and never echoes secret material. Wired into API server construction.
- `.env.example` with safe categories and generated-locally secrets.
- `/api/v1/version` service-identity endpoint and canonical error envelope (`error.code/message/request_id`) for unknown routes; domain-route envelope migration tracked as follow-up.
- Golden-path scripts: `bootstrap.sh`/`bootstrap.ps1` (idempotent, tool checks, local secret generation), `healthcheck.sh`/`.ps1`, `migrate.sh` (+ `packages/db/src/cli.js` JSON CLI, fail-closed exit codes), `verify.sh`, `security-check.sh`, `backup.sh`, `restore.sh` (explicit destination + RESTORE_CONFIRM).
- GitHub security baseline: dependabot.yml (npm + actions), CODEOWNERS, PR template.

### Fixed

- Secret-scanner false positives in `test/security-observability.test.js`: fixture literals now built by concatenation so scanners match nothing while redaction/classification test semantics are unchanged.

### Verification

- Full suite: 288 tests — 287 pass, 0 fail, 1 gated integration skip. `npm run check` clean. Live evidence: healthcheck liveness OK + version payload on a fresh build; migrate CLI exit 2 `{ok:false}` without Postgres; `security-check.sh` PASS (audit 0 vulnerabilities, no secret findings, non-root container user).

### Added (Content Factory foundation — AFF-130/140/141/142/154, 2026-08-24)

- `packages/ai-content/src/factory.js`: ten-persona frozen library; creative brief schema with structural claims traceability (benefit -> evidence reference enforced at creation) and mandatory affiliate disclosure provenance; deterministic hook engine generating 20+ hooks across curiosity/problem/transformation/comparison/mistake/secret/checklist/challenge/story/before-after categories with five-axis scoring and fail-closed rejection of unsubstantiated benefit language; versioned prompt registry (`creative-brief`, `viral-hooks`, `content-quality` v1); content quality gate scoring readability/spam/disclosure/claims/brand 0-100 with hard revision_required stops for missing disclosure or unsupported claims.

### Verification

- `test/content-factory.test.js`: 11/11 pass. Full suite: 299 tests - 298 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Script + Storyboard engines — AFF-143/170/171, 2026-08-24)

- `generateScript`: nine script formats with exact second budgets; canonical hook->problem->insight->solution->demo->[social-proof]->cta->disclosure structure as timestamped scenes; hooks sourced from the scored compliant-hook pool; insights grounded in evidence-backed benefits; social proof only when substantiated by evidence-referenced marketplace proof (enforced at brief creation), omission reason recorded; disclosure carried verbatim.
- `createStoryboard`: aspect-validated scene boards with per-label visuals, duration labels summing to the script budget, editability flag, full lineage, and fail-closed rejection of corrupted scene timestamps.
- Prompt registry: `script-generator@v1`, `storyboard@v1`.

### Verification

- `test/content-factory.test.js`: 19/19 pass. Full suite: 307 tests - 306 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Automation policy plane — AUTO-001/002/003/007, 2026-08-24)

- `packages/automation`: versioned AutomationPolicy model (six modes, allowlists, caps, budgets, score floors, pre-approved content classes, capability flags defaulting fail-closed); typed five-way AutomationDecision with per-check explanations; policy evaluator enforcing tenant match, six-scope kill switches, risk routing, platform allowlist, quality/compliance floors, frequency DEFER, daily/campaign budgets, and mode-specific publish semantics; mandatory audit event on every decision; dry-run mode computing real decisions with zero side effects.

### Verification

- `test/automation-policy.test.js`: 17/17 pass (DENY/ALLOW/APPROVAL/MANUAL_REQUIRED/DEFER, cross-tenant denial, kill-switch scope + deactivation regression, audit-on-denial, dry-run). Full suite: 324 tests - 323 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Measurement layer — DATA-001/002/003, 2026-08-24)

- `packages/analytics/src/events.js`: canonical analytics event envelopes over a 17-type taxonomy with mandatory source classification and frozen lineage identifiers; deterministic provider+external-id deduplication with sha256 payload-fingerprint fallback that is independent of arrival order; immutable tenant-partitioned raw event store; semantic metrics with single documented formulas (docs/ANALYTICS.md), pending-commission exclusion and zero-floor net revenue.

### Verification

- `test/analytics-events.test.js`: 12/12 pass including the master-spec golden dataset (CTR 20%, CVR 20%, net 1500 minor units, EPC 75) and cross-tenant isolation regressions. Full suite: 336 tests - 335 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Offer intelligence foundation — COM-001..004, 2026-08-24)

- `packages/affiliate-core/src/commerce.js`: separated Offer model (provider identity, minor-unit pricing with sale>list rejection, canonical inventory statuses where UNKNOWN is never purchasable, commission evidence); append-only immutable price snapshots; promotion model across the 11-type taxonomy with clock-resolved lifecycle and UNKNOWN-never-active semantics; configurable per-claim freshness thresholds; pre-publish commercial revalidation returning fail-closed BLOCK decisions (`stale_price`, `stale_evidence`, `promotion_expired`) carrying regenerate/remove actions.
- `docs/AFFILIATE-COMMERCE.md`: model separation, freshness gate table, revalidation matrix, golden scenario.

### Verification

- `test/commerce.test.js`: 11/11 pass including tenant-isolation regressions and the master-spec golden commercial scenario (฿1000→฿800 verified "ลด 20%" allowed; ฿850 change blocks the stale creative). Full suite: 347 tests - 346 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Mission Control foundation — UI-001/005/020-022, 2026-08-24)

- Semantic design tokens (`tokens.css`): five-level severity system rendered as color + text label pairs, light/dark theme layers, spacing/radius/typography/z-index scales, reduced-motion and mobile breakpoints.
- `GET /api/ui/overview`: tenant-gated Mission Control payload with six primary KPIs, secondary signals, and a Critical Action Center built from dependency-injected live stores (kill switches -> DANGER, expiring promotions -> WARNING, source failure -> CRITICAL). Degraded sources are explicitly labeled; zeros are never presented as confirmed values. Dynamic strings are HTML-escaped server-side.
- Overview surface renderer (loading/error/empty states, KPI hierarchy) registered into the existing CSP-first hash router without touching the nav contract.

### Verification

- `test/ui-mission-control.test.js`: 6/6 pass. Full suite: 353 tests - 352 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Ingress protection — SEC-021/022, 2026-08-24)

- Keyed token-bucket rate limiter for public API ingress (`/go/:slug`, `/webhooks/:platform`): per tenant/route/address isolation, 429 + Retry-After through the canonical error envelope, deterministic clock injection for tests.
- Typed SecurityEvent recorder (RATE_LIMITED, WEBHOOK_SIGNATURE_FAILURE, WEBHOOK_REPLAY_DENIED, CROSS_TENANT_ACCESS_DENIED, SSRF_BLOCKED, AGENT_PERMISSION_DENIED, KILL_SWITCH_CHANGED, …) emitting frozen records to an injectable sink; wired into API ingress for throttling and invalid webhook signatures.

### Verification

- `test/security-hardening.test.js` 7/7 · `test/api-security-ingress.test.js` 3/3. Full suite: 363 tests - 362 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (CSRF gate — SEC-005b, 2026-08-24)

- `POST /api/workflow/approve` now requires a custom `x-zaff-csrf` header, `application/json` content-type and matching Origin/host — three independent fail-closed checks returning 403 without any state change. Cross-site form/fetch forgeries cannot satisfy the custom-header requirement (no CORS preflight is possible against this app).

### Verification

- New `test/web-csrf.test.js` (6 cases incl. blocked-attempt-leaves-state-unchanged) plus legacy approval fixtures updated to authenticate properly. All web suites 22/22; full suite 369 tests - 368 pass, 0 fail, 1 gated skip; `npm run check` clean.

### Added (Intelligence foundation — ML-001/002/004/020, 2026-08-24)

- `packages/intelligence`: versioned immutable feature definitions across 8 entity types with typed, tenant-partitioned values and per-definition freshness windows (FRESH/AGING/STALE/UNKNOWN; stale values withheld from decisions); `baseline-rules-v1` opportunity ranker producing deterministic, explainable, confidence-graded rankings from verified commerce metrics with hard inventory-safety and promotion-expiry rules.
- `docs/INTELLIGENCE.md`: feature-platform contracts, ranker formula, safety rules.

### Verification

- `test/intelligence-features.test.js` 10/10. Full suite: 379 tests - 378 pass, 0 fail, 1 gated skip. `npm run check` clean. GPG-signed `152b6bf` pushed to origin/main.

### Added (Intelligence stores — ML-005/022, 2026-08-24)

- TrainingDatasetStore: immutable reproducibility metadata per dataset version (label definition, validated time ranges, row counts, feature-set versions).
- PredictionStore: model@version predictions with confidence tiers, future-only validity windows; expired predictions never serve as current while full history remains queryable.
- RecommendationStore: ACTIVE -> feedback lifecycle with single-shot decisions and fail-closed EXPIRED coercion for late acceptances; terminal immutability.

### Verification

- `test/intelligence-stores.test.js` 7/7. Full suite: 386 tests - 385 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Intelligence pipeline — ML-003/023, 2026-08-24)

- `computeOfferFeatures`: derives discount-ratio/inventory/price features from verified commerce offers (stale evidence flows into STALE feature states automatically) and per-product clicks/CVR/net-commission features from the deduplicated analytics event stream via new `summarizeByProduct`.
- `createRecommendationService.rankAndRecord`: runs the baseline ranker and persists every ranked entry as an auditable Recommendation plus the top candidate as a Prediction in the ML-022 stores.

### Verification

- `test/intelligence-pipeline.test.js` 5/5. Full suite: 391 tests - 390 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Intelligence evaluation — ML-021/024, 2026-08-24)

- `evaluateRanking`: offline ranking evaluation with strict-window top-K hit rate (verifiably-bad entries inside the window zero the credit; unobservable windows score 0 — no fabricated hits), Pearson score/outcome correlation reported as null below two paired samples.
- `explainRecommendation`: renders stored recommendations into operator-facing explanations with verbatim evidence reasons, confidence, model version, per-feature freshness and a fail-closed executable/EXPIRED label.

### Verification

- `test/intelligence-evaluation.test.js` 8/8. Full suite: 399 tests - 398 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Model registry + shadow mode — MLOPS-001/004, 2026-08-24)

- ModelRegistry: name@version identity with immutable reproducibility metadata; enforced CANDIDATE→VALIDATING→SHADOW→PRODUCTION lifecycle (REJECTED terminal; RETIRED retained for audit + instant rollback); single-PRODUCTION-per-name with automatic champion demotion on challenger promotion; approver-recorded promotions; fail-closed illegal transitions.
- ShadowComparator: tenant-scoped champion/challenger score pairs with agreement-rate and mean-absolute-delta reporting; empty windows report nulls.

### Verification

- `test/mlops.test.js` 8/8. Full suite: 407 tests - 406 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Model monitoring + drift — MLOPS-005/006, 2026-08-24)

- DriftDetector: numeric feature drift vs registered baselines — relative mean shift with configurable WARN/ALERT ratios, minimum-sample floor returning INSUFFICIENT_DATA instead of guesses, fail-closed unknown features.
- ModelMonitor: prediction total/error/latency and feature stale/missing counters on the shared MetricsRegistry.

### Verification

- `test/mlops-monitoring.test.js` 8/8. Full suite: 415 tests - 414 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Portfolio + rollback — MLOPS-007/OPT-001, 2026-08-24)

- `registry.rollbackModel`: instant audited rollback to any previously registered version (actor + reason required; ghost/no-op targets refused).
- `classifyPortfolio`: deterministic SCALE/MAINTAIN/TEST/WATCH/PAUSE classification over ranked recommendations with drift-aware WATCH caps and reason-carrying frozen entries.

### Verification

- `test/intelligence-portfolio.test.js` 6/6. Full suite: 421 tests - 420 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Experiment recommendations + exploration policy — OPT-002/003, 2026-08-24)

- `recommendExperiments`: LOW-confidence candidates become structured CREATE_EXPERIMENT proposals with control/challenger variants and a non-negotiable 30-sample-per-variant statistical floor; proven winners are never experiment targets.
- `createExplorationPolicy`: validated configurable exploration/exploitation ratio with deterministic slot allocation prioritizing exploratory candidates.

### Verification

- `test/intelligence-optimization.test.js` 8/8. Full suite: 429 tests - 428 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Autonomous decision gate — OPT-004, 2026-08-24)

- `packages/intelligence/src/decision-gate.js`: composes live commercial revalidation (stale claims / expired promotions / revalidation ERRORS all fail closed to DENY) with the automation policy evaluator — producing combined ALLOW/APPROVAL_REQUIRED/DENY verdicts with blockers, policy-check explanations and audited gate decisions. Model predictions can never bypass policy or override live commercial truth.

### Verification

- `test/decision-gate.test.js` 8/8 (incl. stale-price DENY despite high ranker confidence, kill-switch precedence, cross-tenant denial, expired-promotion denial, audit capture). Full suite: 437 tests - 436 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Platform foundation — MM-005-lite/MM-006/SEC-008-lite, 2026-08-24)

- `packages/events`: tenant-partitioned domain event bus with per-handler bounded retry, dead-letter capture, and cross-tenant delivery isolation.
- `packages/storage`: media-upload validation (MIME allowlist, size caps, traversal-proof generated keys), local filesystem driver, HMAC-signed expiring object URLs with tamper verification.

### Verification

- `test/platform-foundation.test.js` 5/5. Full suite: 442 tests - 441 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Envelope migration + Redis adapter + live integration — 2026-08-24)

- Domain route errors migrated to the canonical envelope (`{error:{code,message}}`, uppercase codes) across all 18 sites in the API business layer.
- `packages/events/redis-streams.js`: stream publisher writing tenant/type/eventId/payload triples via XADD with an injectable client and an in-memory ring fallback when ioredis/REDIS_URL are absent.
- db client: remote-host TLS negotiation + ipv4first DNS resolution (required for managed Postgres on IPv6-only-DNS hosts).

### Live-infrastructure evidence (first of its kind)

- Connected to the provisioned Supabase Postgres through the IPv4 session pooler using operator-provided credentials (`.env.*`, gitignored).
- Applied all three project migrations via the checksummed drift-detecting migrator: `001_core_tenant_rls`, `002_workflow_outreach`, `003_billing_ai_analytics` — re-run proved idempotency (applied:[], skipped:3).
- Verified schema landed: 18 public tables, every one RLS-enabled.
- `test/db.test.js` integration case ran against the real database: 7/7 pass, zero skips.

### Added (JWKS/OIDC verification — MM-004 foundation, 2026-08-24)

- `packages/security/src/jwks.js`: cached JWKS client (injectable fetch, TTL + once-per-generation forced refresh on unknown kid — request-flood proof) and an RS256-only `verifyJwt` enforcing signature, expiry/not-before, issuer and audience with timing-safe comparisons; alg=none/symmetric algorithms rejected structurally.

### Verification

- `test/security-jwks.test.js` 5/5. Full suite: 451 tests - 450 pass, 0 fail, 1 gated skip. `npm run check` clean.

### Added (Storage SigV4 + envelopes + redis streams — 2026-08-24)

- `packages/storage/src/s3.js`: zero-dependency AWS Signature V4 S3 driver sharing the immutable-key contract with the local driver.
- Domain-route errors fully migrated to the canonical envelope; `packages/events/redis-streams.js` XADD publisher with memory fallback.

### Live evidence

- Supabase Postgres (IPv4 pooler): migrations 001..003 applied idempotently, 18 RLS-enabled tables, integration suite 7/7 zero-skip.
- Supabase S3 endpoint: SigV4 signature accepted to resource resolution; writes return 403 provider-permission denial — recorded as a credential/policy blocker (fail-closed, no bypass).

### Added (Durable event persistence — MM-003-lite, 2026-08-24)

- `packages/db/src/analytics-repo.js`: awaited multi-row parameterized persistence of canonical event envelopes into live `analytics_events` (lineage+payload preserved in dimensions jsonb), application-level dedupe before any database round-trip, and async readback mapping.
- Migration `004_canonical_analytics_types.sql`: replaced the legacy 6-value event_type CHECK with the canonical 17-type taxonomy — applied live via the migrator, resolving real schema drift through the intended mechanism.

### Live evidence

- Tenant seeded -> canonical `affiliate_click_recorded` envelope persisted to Supabase Postgres -> readback matched eventId and type.
- Migrator applied 004 live then proved idempotency (skipped:4 on re-run).

### Deployed (2026-08-25) — zaffiliate.zeaz.dev is LIVE

- Public HTTPS via a dedicated locally-managed Cloudflare Tunnel (`77107d8b…`) whose ingress (`zaffiliate.zeaz.dev -> http://127.0.0.1:8788`) is fully self-hosted — no dashboard dependency for future changes.
- Connector runs as `zaffiliate-tunnel.service` (token via 600-permission env file); API as `zaffiliate.service`; both enabled for boot persistence.
- DNS CNAME managed by the new Terraform stack in the zeaz repo (signed f1264a3).
- Verified live: `https://zaffiliate.zeaz.dev/healthz` -> 200 `{"ok":true,...}`; `/api/v1/version` reports production build.
- `scripts/deploy-host.sh` now provisions the tunnel connector too (idempotent, re-runnable).

### Added (Feature wiring — 2026-08-25)

- `apps/api/src/features-api.js`: tenant-gated `/api/v1` surfaces wiring existing packages over HTTP — commerce offers list, intelligence opportunities ranking (rank-and-record), recommendations list + operator feedback, analytics overview. POST bodies bounded (64KB) with strict JSON parsing; gating scoped to known feature prefixes so unknown routes keep the canonical 404 envelope.
