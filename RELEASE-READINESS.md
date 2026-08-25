# RELEASE-READINESS — zaffiliate Affiliate Automation OS

Updated: 2026-08-25 · Release source of truth (Gold Master master-spec §3). This document states exactly one release decision backed by evidence. Feature count never implies readiness.

## Release Identity

| Field | Value |
|---|---|
| Version | 0.1.0 (`packages/release/src/version.js`) |
| Commit | `333b0248b66dd09475f61d0a8e83ed4687b0c2b8` + uncommitted GM-001 slice |
| Branch | `main` (origin/github.com/cvsz/zaffiliate) |
| Build | source-dist monorepo; container image via root `Dockerfile` (non-root) |
| Created | 2026-08-25 |
| Maturity | **BETA** (primary workflows integrated and testable; hardening gaps enumerated below) |
| Decision | **NOT_READY_FOR_GOLD_MASTER** (§89) — evidence-backed blockers listed |

Machine-readable manifest: `node scripts/generate-release-manifest.mjs` (commit, components, migrations, verification fields); SBOM via `scripts/generate-sbom.mjs`; attestation via `scripts/gpg-attest.mjs`.

## Scope

Frozen for stabilization (§5). Allowed: bug fixes, security fixes, release blockers, documentation corrections, operational hardening. Deferred features below are out of scope until Gold Master gates clear.

## Included Features (verified this cycle)

- Tenancy + RBAC + tamper-evident audit chain; RLS on all 18 public tables (live Supabase).
- Affiliate lifecycle: products/offers/links/clicks/conversions/commissions with immutable minor-unit snapshots.
- Commerce truth: price snapshots, promotions with clock-resolved windows, freshness gate, stale-claim BLOCK engine.
- Safe redirect `/go/:slug` + multi-platform webhook ingress (TikTok canonical signature, generic HMAC, replay guard, event dedupe).
- Canonical analytics envelope (17 types), dedup, raw persistence to Postgres (migration 004).
- Intelligence loop INTEL-0..2: feature store → baseline ranker → recommendations/predictions → evaluation/explanation → audited decision gate (policy + capability + commercial revalidation).
- Automation policy plane: versioned policies, typed decisions, six-scope kill switches, dry-run, audited denials.
- Content factory: personas, evidence-gated briefs, hook/script/storyboard engines, prompt registry, compliance hard-stops.
- HTTP surface `/api/v1/*` for commerce, intelligence, analytics, automation, content (tenant-gated, canonical envelopes).
- Public deployment https://zaffiliate.zeaz.dev (Cloudflare → tunnel 77107d8b → Caddy → API :8788).

## Deferred Features (out of release scope)

OAuth/OIDC browser login + token refresh · Meta/YouTube catalog+analytics adapters · image/video factories (storage-blocked) · calendar API/UI · trend engine · trained models (INTEL-3+) · k8s/helm packaging · workers/scheduler split apps.

## Known Limitations

- All live provider calls BLOCKED on sandbox/production credentials; capability claims are mock/sandbox-verified only.
- Supabase S3 writes return 403 (provider permission); media persistence fail-closed.
- Redis streams publisher degrades to in-memory ring without REDIS_URL; distributed rate-limit store pending.
- PublicationJob durable persistence pending (workflow-engine idempotency proven in-memory only).

## System Inventory (§6)

| Subsystem | Status | Evidence / gap |
|---|---|---|
| Web Control Plane (apps/web) | COMPLETE | CSP-first surfaces, CSRF gate, Mission Control KPIs; 22 web tests |
| API (apps/api) | COMPLETE | tenant-gated routes, envelopes, rate limiting, webhook ingress |
| Database layer (packages/db) | COMPLETE | pooled client, checksummed migrator, drift fail-closed, analytics repo |
| Contracts/schema | COMPLETE | normalized domain model, automation/analytics schemas |
| Identity & billing | COMPLETE | sessions, SHA-256 API keys, plans, ledger |
| Affiliate core | COMPLETE | lifecycle + commerce truth engines |
| Adapters (TikTok/Shopee/Lazada/LINE) | PARTIAL | TikTok full SDK; others signed clients; live verification blocked on creds |
| Meta / YouTube | PARTIAL | publishing boundary only |
| Workflow engine | COMPLETE | grants, DLQ, approvals, reconciliation |
| Outreach | COMPLETE | consent, quiet hours, budgets |
| AI content factory | PARTIAL | generators complete; external LLM/media providers blocked on creds |
| Analytics | PARTIAL | envelope/dedupe/persistence complete; warehouse/attribution windows pending |
| Intelligence | COMPLETE (INTEL-0..2) | full loop live; trained models deferred |
| Automation policy | PARTIAL | policy plane + kill switches complete; durable workflow state + shadow mode pending |
| Security pkg | COMPLETE | secrets, redaction, SSRF validation, JWKS verify, keyed rate limiter |
| Observability | COMPLETE | structured logs w/ redaction, MetricsRegistry, /metrics, SLO eval, alert configs |
| Storage | PARTIAL | local driver + SigV4 S3; writes fail-closed BLOCKED on bucket perms |
| Events bus | PARTIAL | redis XADD publisher + memory fallback; not default transport |
| Release engineering | COMPLETE | manifest/SBOM/changelog scripts, gpg attest, smoke/soak/load/fault-inject |
| Workers/Scheduler apps | NOT_REQUIRED_FOR_RELEASE | stub-class; workflow runtime covers scheduling in-process |

## Requirement Traceability (mandatory gates → evidence)

| Gate (master-spec) | Implementation | Tests | Runtime evidence |
|---|---|---|---|
| Tenant isolation (§10) | tenancy.js, RLS migrations | tenancy.test.js, db RLS suite, e2e isolation cases | CI psql job; cross-tenant 404s verified over HTTP |
| RBAC (§11) | grants.js role-rank | audit-grants.test.js | escalation audited |
| Duplicate financial events (§29) | event-dedupe.js replay guard | tiktok-resources.test.js (incl. GM-001 frozen-clock regressions), api-business-routes.test.js | duplicate → 200 single conversion; clock-mixing defect fixed GM-001 |
| Golden metrics (§27) | analytics events summarize | analytics-events.test.js golden dataset | deterministic CTR/CVR/net/EPC asserted |
| Commercial claim validity (§17/18) | commerce.js revalidateCommercialClaim | commerce.test.js incl. golden scenario | stale-price BLOCK, promotion-expiry BLOCK |
| Decision gate (§20–22) | intelligence/decision-gate.js | decision-gate.test.js (8 cases) | DENY on stale price/kill switch/cross-tenant/expired promo |
| Automation policy + kill switch (§22/23) | automation/index.js | automation-policy.test.js (17 cases) | six-scope switches honored, audited denials |
| Publishing safety (§15/16) | workflow runtime + contracts PublicationJob + `packages/db/publication-jobs-repo.js` (migration 005, skip-locked claim, retry budget, optimistic transitions) | workflow tests + publication-jobs-repo.test.js incl. restart-survival integration | durable idempotent create/claim/transition proven live on Supabase PG; HTTP orchestrator wiring remains for a later slice |
| Migration safety (§40–42) | packages/db migrator + migrate-data.mjs | db.test.js, migration-cutover.test.js | drift fail-closed; fresh-checkout ENOENT fixed GM-001 |
| Security ingress (§48) | SSRF validator, rate limiter, JWKS, CSRF gate | ssrf-validation, security-hardening, api-security-ingress, web-csrf suites | 429/401/403 fail-closed paths tested |

## Test Evidence

- `npm test`: **479 tests — 477 pass, 0 fail, 2 environment-gated skips** (2026-08-25, GM-002 slice; skips are DB-reachability-gated integrations that run green against live Supabase PG when DATABASE_URL points at the pooler).
- Live PG integration (Supabase pooler): publication-jobs suite 8/8 zero-skip — migration 005 applied idempotently; job created → duplicate suppressed → survived fresh-client "restart" → claimed exactly once (skip-locked) → transitioned to published.
- `npm run check`: clean (all modules incl. publication-jobs).
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `scripts/security-check.sh`: PASS (tracked-secret material, high-signal patterns, non-root container).

## Deployment Evidence

- Production service live: systemd `zaffiliate.service` :8788 behind Caddy + dedicated Cloudflare tunnel; `https://zaffiliate.zeaz.dev/healthz` → 200 `{"ok":true}` (DEPLOY-001 record, exec-planning.md).
- Deploy mechanism: `scripts/deploy-host.sh` (idempotent api+tunnel+edge+migrations).

## Rollback Evidence

- Application rollback: previous image/version redeploy path exists (systemd unit pinning); staging rollback rehearsal NOT yet executed → blocker B5.
- Data rollback: migrator refuses irreversible operations silently? No — drift is fail-closed; per-migration rollback classification (§42) NOT documented → blocker B5.

## Security Status

SAST = audit + secret scan + syntax gates (semgrep placeholder). SBOM generator present. Container non-root asserted. Findings register in THREAT-MODEL.md. No critical/high unresolved exploitable findings known at scan level; deep SAST (§49) pending.

## Provider Status

| Provider | Auth | Catalog | Publishing | Analytics | Last verified | State |
|---|---|---|---|---|---|---|
| TikTok Shop | signed SDK | sandbox/mocked | boundary + capability states | mocked | 2026-08-24 | sandbox-only |
| Shopee | HMAC client | n/a | n/a | webhook conversions | 2026-08-24 | sandbox-only |
| Lazada | signed client | n/a | n/a | n/a | 2026-08-24 | sandbox-only |
| Meta | absent | absent | boundary only | absent | never | not production-ready |
| YouTube | absent | absent | boundary only | absent | never | not production-ready |

Only mock/sandbox capabilities may be claimed. No live capability is production-ready (credential blocker B2).

## Operational Status

Observability active (/metrics, structured logs, SLO eval). Runbooks partial (OPERATIONS.md + docs/operations). Operator recovery tools: reconcile/smoke/fault-inject scripts exist; audited admin retry/reprocess surface pending (§80). Backup drill runs in CI (scripts/backup-restore-drill.mjs); restore-into-clean-environment rehearsal not evidenced.

## Blocking Issues (evidence-backed)

| ID | Blocker | Severity | Status |
|---|---|---|---|
| B1 | CI red on main: dedupe clock-mixing time bomb (duplicate-event gate) + fresh-checkout ENOENT in migration writer | BLOCKER | CLOSED 2026-08-25 — GM-001 commit `531b69d`, CI green: https://github.com/cvsz/zaffiliate/actions/runs/32871141615 |
| B2 | Live provider credentials unprovisioned; no provider capability may be marked production-ready | BLOCKER | open |
| B3 | PublicationJob durable persistence (MM-003 remainder); idempotent publish/retry/DLQ must survive restart | BLOCKER | CLOSED 2026-08-25 — GM-002 slice: migration 005 + `packages/db/src/publication-jobs-repo.js`; restart-survival integration proven live against Supabase PG (8/8 zero-skip) |
| B4 | OAuth browser flow + token refresh missing; REAUTH_REQUIRED lifecycle unimplementable | HIGH | open |
| B5 | Restore-into-clean-environment rehearsal + migration rollback classification not evidenced (§41/42/56) | HIGH | open |
| B6 | Distributed rate-limit store (Redis) pending; single-instance limiter only | MEDIUM | open |
| B7 | Object storage writes fail-closed BLOCKED on bucket permissions | HIGH | open |
| B8 | Performance/load baselines not recorded against representative workloads (§43–47) | MEDIUM | open |
| B9 | Full-chain multi-tenant golden E2E over HTTP (org A vs B, §10) not assembled end-to-end | HIGH | open |
| B10 | Operator/developer handbooks incomplete (§83/84) | LOW | open |

## Approval

Not approved for Gold Master. B1 and B3 closed with recorded evidence. Next bounded task: B5 (restore-into-clean-environment rehearsal + per-migration rollback classification), then B4 (OAuth/token refresh). B2 requires external credential provisioning.
