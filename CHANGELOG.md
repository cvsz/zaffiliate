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
