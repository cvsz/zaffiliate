# RELEASE-READINESS — zaffiliate Affiliate Automation OS

Updated: 2026-08-31 · Release source of truth (Gold Master master-spec §3). This document states exactly one release decision backed by evidence. Feature count never implies readiness.

## Release Identity

| Field | Value |
|---|---|
| Version | 1.0.0 (`package.json`) |
| Commit | `SWEEP-002` (595-test baseline, 13 migrations, publishing HTTP + trend + automation durable + k8s minimal) |
| Branch | `main` (origin/github.com/cvsz/zaffiliate) |
| Build | source-dist monorepo; container image via root `Dockerfile` (non-root, `no-new-privileges:true`) |
| Created | 2026-08-31 |
| Maturity | **BETA** (primary workflows integrated and durable; external-provider blockers enumerated below) |
| Decision | **NOT_READY_FOR_GOLD_MASTER** (§89) — evidence-backed blockers listed |

Machine-readable manifest: `node scripts/generate-release-manifest.mjs` (commit, components, migrations, verification fields); SBOM via `scripts/generate-sbom.mjs`; attestation via `scripts/gpg-attest.mjs`.

## Scope

Frozen for stabilization (§5). Allowed: bug fixes, security fixes, release blockers, documentation corrections, operational hardening. Deferred features below are out of scope until Gold Master gates clear.

## Included Features (verified this cycle)

- Tenancy + RBAC + tamper-evident audit chain; **RLS on all 33 public tables**, 13 migrations (001–013) drift-checked.
- Affiliate lifecycle: products/offers/links/clicks/conversions/commissions with immutable minor-unit snapshots — **now durable** via `packages/db/src/affiliate-core-repo.js` (migration 007), tenant-isolated outbox `affiliate_domain_outbox`, `packages/events/src/outbox-dispatcher.js` streaming to production Redis (`compose.selfhost.yaml` hard-gated secrets, `node-redis-runtime.js`).
- Campaign lifecycle: `campaigns` (migration 011) 5-state machine `draft→active↔paused→completed/cancelled`, `affiliate_links.campaign_id` FK, `packages/db/src/campaign-repo.js` + `apps/api/src/campaign-api.js` (`/api/v1/campaigns`, campaign-scoped link generation), audit + outbox, RLS proofs.
- Conversion reconciliation: `conversions.status` pending/confirmed/refunded/rejected (migration 012, CHECK + index), `packages/db/src/conversion-reconciliation-repo.js` (status audit + outbox dedup, currency-safe aggregates), `apps/api/src/conversion-api.js` (`/api/v1/conversions`, authenticated list/commission-summary/status PATCH with owner/admin guard), RLS proofs.
- Publishing orchestrator: `publication_jobs` (005, RLS) + `apps/api/src/publication-api.js` (`POST /api/v1/publications`, `GET ?status`, `POST /claim`, `GET /:id`, `POST /:id/transition`) via `production-server.js` with Bearer+tenant+owner/admin guard, rate-limited, tested `test/publication-api.test.js` 5/5.
- Trend & opportunity scoring: `packages/trend/src/index.js` tenant-partitioned `createTrendStore` (`ingest` validated, `listRecent` ranked, `scoreOpportunity` composite, confidence HIGH/MEDIUM/LOW), tested `test/trend.test.js` 4/4.
- Durable local auth + recovery: `local_auth_users`/`auth_sessions`/`auth_recovery_tokens` (migration 008), `apps/api/src/auth-service.js` (dummy-hash timing equalization, SHA-256 token hashes, rate-limited recovery) + `apps/api/src/auth-api.js` (`/api/v1/auth/*` register/login/me/logout/password-reset/email-verification).
- OAuth/OIDC persistence: encrypted OAuth identity + pending auth + provider tokens (migration 009) + standalone OIDC login bootstrap (migration 010, global `oauth_identity_directory` NUL-byte hash, sync trigger), `packages/db/src/{oauth-repo,oauth-login-repo}.js`, `production-oauth-api.js` with JWKS nonce+exp verification — provider registration still credential-blocked.
- Commerce truth: price snapshots, promotions with clock-resolved windows, freshness gate, stale-claim BLOCK engine.
- Safe redirect `/go/:slug` + multi-platform webhook ingress (TikTok canonical signature, generic HMAC, replay guard, event dedupe) — async path `business-async.js` resolves via durable repo when `AFFILIATE_RUNTIME_BACKEND=postgres`.
- Canonical analytics envelope (17 types), dedup, raw persistence to Postgres (migration 004) + `packages/db/src/analytics-repo.js` now re-exported via `packages/db/src/index.js` (`ON CONFLICT DO NOTHING`).
- Intelligence loop INTEL-0..2: feature store → baseline ranker → recommendations/predictions → evaluation/explanation → audited decision gate (policy + capability + commercial revalidation).
- Automation policy plane: versioned policies, typed decisions, six-scope kill switches, dry-run, audited denials + **durable** `013_automation_state.sql` (`automation_policies` + `automation_kill_switches` RLS, `packages/db/src/automation-repo.js` transaction with `app.tenant_id`).
- Provider capability manifests: `packages/adapters/src/capabilities.js` now **MM-007** fields `restrictions/requiredDisclosures/rateLimits/contentConstraints/lastVerifiedAt` (tiktok lastVerified 2026-08-30).
- Content factory: personas, evidence-gated briefs, hook/script/storyboard engines, prompt registry, compliance hard-stops.
- HTTP surface `/api/v1/*` for auth/oauth/campaigns/conversions/publications + commerce/intelligence/analytics/automation/content + `/go/:slug` + `/webhooks/:platform` (tenant-gated, canonical envelopes, Bearer auth where required).
- Web Mission Control: `GET /api/ui/overview` + **new** `GET /api/ui/revenue-trend` (7-day series), `GET /api/ui/integration-health`, `GET /api/ui/worker-health` (queue depth) via `apps/web/server.js`.
- Hardened self-hosting: `compose.selfhost.yaml` (postgres 17 + redis 7, `no-new-privileges:true`, healthchecks, read-only api) + **k8s** `deploy/k8s/deployment.yaml` + Helm `deploy/helm/zaffiliate/` and hardened auth/OIDC surfaces.
- Public deployment https://zaffiliate.zeaz.dev (Cloudflare → tunnel 77107d8b → Caddy → API :8788).

## Deferred Features (out of release scope)

Meta/YouTube catalog+analytics adapters · image/video FFmpeg render (storage 403-blocked) · calendar API/UI (still MISSING) · trained models (INTEL-3+, shadow with real paired data) · workers/scheduler split apps (stub-class, covered by outbox dispatcher in-process). Trend engine, publishing HTTP, k8s minimal manifests, and automation durable state are now **included** (see above); OAuth/OIDC login is implemented and wired — only provider client registration remains credential-blocked; token-refresh is durable (encrypted token store) and gated on provider credentials.

## Known Limitations

- Live provider catalog/publishing calls BLOCKED on sandbox/production credentials (TikTok affiliate product not enabled on legacy AppKey — 40006 `no schema found`); capability claims are sandbox/mocked only.
- S3 writes return 403 (bucket permission); media persistence fail-closed (B7).
- Redis streams now production-declared (`compose.selfhost.yaml` hard-requires `REDIS_PASSWORD`; `node-redis-runtime.js`); in-memory fallback retained only for unit-test isolation, not for production.
- Distributed rate-limit store resolved (GM-B6 atomic Lua token bucket, fail-closed to memory on Redis outage).

## System Inventory (§6)

| Subsystem | Status | Evidence / gap |
|---|---|---|
| Web Control Plane (apps/web) | COMPLETE | CSP-first surfaces, CSRF gate, Mission Control KPIs + revenue-trend/integration-health/worker-health (`/api/ui/*`); 22 web tests + new panel routes |
| API (apps/api) | COMPLETE | tenant-gated routes, canonical envelopes, Bearer+tenant-header auth, rate limiting, webhook ingress (`business-async.js` durable path), campaign/conversion/publication/auth/oauth routes via `production-server.js` |
| Database layer (packages/db) | COMPLETE | pooled client (ipv4first TLS), checksummed migrator (13 migrations, drift fail-closed, `ROLLBACK.md` 013), affiliate/auth/oauth/campaign/conversion/automation/analytics/publication repos |
| Contracts/schema | COMPLETE | normalized domain model, campaign/conversion/affiliate/trend schemas, automation/analytics schemas |
| Identity & billing | COMPLETE | sessions, SHA-256 API keys, plans, ledger, local auth (`auth-service.js`+`auth-repo.js`) |
| Affiliate core | COMPLETE | lifecycle + commerce truth engines; durable repo (`affiliate-core-repo.js` + outbox dispatcher) with `AFFILIATE_RUNTIME_BACKEND=postgres` |
| Campaigns | COMPLETE | `campaign-repo.js` (5-state machine, RLS) + `campaign-api.js` + tenant RLS proofs |
| Conversions / reconciliation | COMPLETE | `conversion-reconciliation-repo.js` + `conversion-api.js` + tenant RLS proofs |
| Publishing orchestrator | COMPLETE | `publication-jobs-repo.js` + `publication-api.js` (`POST /api/v1/publications`, `POST /claim`, `POST /:id/transition`) via `production-server.js` |
| Trend & opportunity | COMPLETE | `packages/trend/src/index.js` (`ingest`/`listRecent`/`scoreOpportunity`) tenant-partitioned, tested 4/4 |
| Local auth + recovery | COMPLETE | `auth-service.js`+`auth-repo.js` (password verify dummy-hash, recovery rate-limit, email-verify) |
| OAuth / OIDC login | COMPLETE (provider-creds blocked) | `oauth-repo.js`+`oauth-login-repo.js`, `oauth-runtime-factory.js`, `production-oauth-api.js` with JWKS nonce verification, global `oauth_identity_directory` NUL-byte hash |
| Adapters (TikTok/Shopee/Lazada/LINE) | PARTIAL | TikTok full SDK; others signed clients; live verification blocked on creds; manifests now MM-007 fields |
| Meta / YouTube | PARTIAL | publishing boundary only |
| Workflow engine | COMPLETE | grants, DLQ, approvals, reconciliation |
| Outreach | COMPLETE | consent, quiet hours, budgets |
| AI content factory | PARTIAL | generators complete; external LLM/media providers blocked on creds; video FFmpeg deferred |
| Analytics | PARTIAL | envelope/dedupe/persistence complete; warehouse/attribution windows pending (intentionally deferred) |
| Intelligence | COMPLETE (INTEL-0..2) | full loop live; trained models INTEL-3+ deferred pending production data |
| Automation policy | COMPLETE | policy plane + kill switches complete + **durable** `013_automation_state.sql` + `automation-repo.js`; shadow mode pending (INTEL-3 backlog) |
| Security pkg | COMPLETE | secrets, redaction, SSRF validation, JWKS/OIDC verify, keyed + Redis-distributed rate limiter |
| Observability | COMPLETE | structured logs w/ redaction, MetricsRegistry, /metrics, SLO eval, alert configs |
| Storage | PARTIAL | local driver + SigV4 S3 + hardened `content-validation.js`; writes fail-closed BLOCKED on bucket perms (B7) |
| Events bus | COMPLETE | domain bus + Redis XADD publisher (`redis-streams.js`) + declared production runtime (`node-redis-runtime.js`) + `outbox-dispatcher.js` (lease/mark/release) + analytics re-export |
| Release engineering | COMPLETE | manifest/SBOM/changelog scripts, gpg attest, smoke/soak/load/fault-inject, `check` 157 gates, CodeQL + dependabot |
| Self-hosting | COMPLETE | `compose.selfhost.yaml` (postgres 17 + redis 7, non-root, `no-new-privileges:true`), `.env.selfhost` gated secrets + `deploy/k8s` + Helm chart minimal |
| Workers/Scheduler apps | NOT_REQUIRED_FOR_RELEASE | stub-class; workflow runtime + outbox dispatcher covers scheduling in-process |

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
| Publishing safety (§15/16) | workflow runtime + contracts PublicationJob + `packages/db/publication-jobs-repo.js` (005, skip-locked claim, retry budget, optimistic transitions) + `apps/api/src/publication-api.js` via `production-server.js` | `test/publication-jobs-repo.test.js` + `test/publication-api.test.js` (5/5) incl. restart-survival + Bearer/tenant/owner guard | durable idempotent create/claim/transition proven live on PG; HTTP orchestrator now wired (`POST /api/v1/publications`, `POST /claim`, `POST /:id/transition`) |
| Affiliate persistence (§21/30) | `affiliate-core-repo.js` (007) + `affiliate_domain_outbox` + `outbox-dispatcher.js` | affiliate-core.test.js + affiliate-lifecycle.test.js + `db/tests/affiliate-persistence.sql` + runtime-factory tests | tenant RLS via app role, idempotent `ON CONFLICT (tenant_id, external_order_id) DO NOTHING`, transactional outbox, lease-claim → stream publish → mark-dispatched |
| Campaign lifecycle | `campaign-repo.js` (011) + `campaign-api.js` + `affiliate_links.campaign_id` FK | `test/campaign-api.test.js`, `test/campaign-production-wiring.test.js`, `db/tests/campaign-isolation.sql` | owner/admin guard, campaign must be active to generate links, RLS isolation tenant A/B |
| Conversion reconciliation | `conversion-reconciliation-repo.js` (012) + `conversion-api.js` | `test/conversion-api.test.js`, `test/conversion-production-wiring.test.js`, `test/conversion-reconciliation-postgres.test.js` gated on PG reachability, `db/tests/conversion-reconciliation.sql` | status CHECK + tenant/status index, audit `conversion.status_changed` + outbox dedup (same-status retry emits 1 event), currency-safe `SUM(::text)` aggregates, RLS tenant isolation |
| Trend & opportunity (§4–5) | `packages/trend/src/index.js` (`ingest`/`listRecent`/`scoreOpportunity`) | `test/trend.test.js` (4/4) ingest validation, tenant isolation, scoring HIGH/MEDIUM/LOW | deterministic composite scoring, 6 gated skips still 6 (trend unit does not require DB) |
| Automation durable state | `automation-repo.js` + `013_automation_state.sql` (`automation_policies` + `automation_kill_switches` RLS) | `test/automation-policy.test.js` + `packages/db/src/automation-repo.js` transaction with `app.tenant_id` | policy upsert + kill-switch list/set with tenant `app.tenant_id` transaction |
| Local auth + recovery | `auth-service.js`+`auth-repo.js` (008) | `test/local-auth-service.test.js`, `test/production-auth-api.test.js` | dummy-hash timing equalization, token SHA-256, recovery window 10m/3-recent RLS, email-verify & password-reset flows |
| OAuth/OIDC persistence | `oauth-repo.js`+`oauth-login-repo.js` (009/010) + JWKS nonce verification | `test/production-oauth-*`, `test/oauth-login-repo.integration.test.js`, `test/oidc-verification-parity.test.js` | encrypted token store, NUL-byte hash `identity_hash`, sync trigger, token `BOUND` before buffering |
| Provider capability MM-007 | `capabilities.js` extended manifest | `test/provider-capability.test.js` (10 tests) + `packages/adapters` spec suites | `restrictions/requiredDisclosures/rateLimits/contentConstraints/lastVerifiedAt` now mandatory in manifest, tiktok lastVerified 2026-08-30 |
| Mission Control extended | `apps/web/server.js` revenue-trend/integration-health/worker-health | `test/ui-mission-control.test.js` + manual `GET /api/ui/{revenue-trend,integration-health,worker-health}` over HTTP | 3 new panels: 7-day netCommission series, provider manifest health, worker queue depth |
| Migration safety (§40–42) | packages/db migrator (13 migrations) + `migrate-data.mjs` | db.test.js, migration-cutover.test.js, rollback classification `db/migrations/ROLLBACK.md` (007–013) | drift fail-closed; fresh-checkout ENOENT fixed GM-001; forward-fix preferred post-data |
| Security ingress (§48) | SSRF validator, keyed + Redis Lua rate limiter, JWKS with OIDC, CSRF gate | ssrf-validation, security-hardening, api-security-ingress, rate-limit-redis, web-csrf, oidc-verification suites | 429/401/403 fail-closed paths tested; Redis store cross-instance budget + Retry-After proven |
| Storage hardening | `content-validation.js` + `s3.js` immutable-key + size/MIME gates | `test/storage-hardening.test.js`, `test/storage-s3.test.js` | path-traversal-proof keys, HMAC-signed URLs, SigV4 four-stage HMAC, tamper detection |
| Production Redis runtime | `node-redis-runtime.js` declared client + `compose.selfhost.yaml` hard-gated secrets | `test/events-node-redis-runtime.test.js`, `test/outbox-dispatcher.test.js` | declared `redis:7` with `REDIS_PASSWORD` gating, fail-closed when connector unavailable, outbox lease release on publish failure |
| K8s deploy | `deploy/k8s/deployment.yaml` + Helm chart | `deploy/k8s/README.md`, `deploy/helm/zaffiliate/*` | minimal 2-replica non-root readOnly, probes, service; full TF multi-region intentionally deferred |

## Test Evidence

- `npm test`: **595 tests — 589 pass, 0 fail, 6 environment-gated skips** (2026-08-31 SWEEP-002: 586 baseline + `test/trend.test.js` 4/4 + `test/publication-api.test.js` 5/5; 6 skips are DB-reachability-gated integrations that run green against `compose.selfhost` PG / `affiliate-persistence` CI).
- New modules: `packages/trend/src/index.js` (ingest→list→scoreOpportunity, tenant isolation), `apps/api/src/publication-api.js` (Bearer+tenant+owner guard, create/claim/transition), `packages/db/src/automation-repo.js` (migration 013 RLS), `deploy/k8s` minimal.
- Reconciliation lifecycle: `conversion-reconciliation-postgres.test.js` now gates on `db.check().reachable` instead of static `DATABASE_URL` presence — no spurious `28P01` failures on wrong-env `DATABASE_URL`; `test/conversion-reconciliation-postgres.test.js` SKIP when unreachable, PASS live on `affiliate-persistence` CI.
- Restore rehearsal (§55/56/41): PASSED end-to-end — see blocker B5; evidence artifact `dist/restore-rehearsal-evidence.json` (`passed: true`).
- Multi-tenant golden chain (§10): PASSED over real HTTP — see blocker B9.
- Campaign/Conversion RLS suites: `db/tests/{affiliate-persistence,conversion-reconciliation}.sql` run green on `affiliate-persistence` workflow (postgres:16-alpine, 007 + 012 migrations + bootstrap role `zaffiliate_app_test`); automation state RLS proved via `013_automation_state.sql` policies.
- `npm run check`: clean (157 syntax gates incl. `affiliate-core-repo.js`, `campaign-repo.js`, `conversion-reconciliation-repo.js`, `outbox-dispatcher.js`, `publication-api.js`, `trend/index.js`, `automation-repo.js`).
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `scripts/security-check.sh`: PASS (tracked-secret material, high-signal patterns, non-root container).

## Deployment Evidence

- Production service live: systemd `zaffiliate.service` :8788 behind Caddy + dedicated Cloudflare tunnel; `https://zaffiliate.zeaz.dev/healthz` → 200 `{"ok":true}` (DEPLOY-001 record, EXEC-PLANNING.md).
- Deploy mechanism: `scripts/deploy-host.sh` (idempotent api+tunnel+edge+migrations).

## Rollback Evidence

- Application rollback: previous image/version redeploy path exists (systemd unit pinning, `compose.selfhost.yaml` + `deploy/k8s` image pinning); staging rollback rehearsal evidenced via `restore-rehearsal.mjs` (B5); `deploy/k8s/README.md` documents `kubectl apply` + secret creation.
- Data rollback: migrator drift is fail-closed; per-migration rollback classification (§42) documented in `db/migrations/ROLLBACK.md` (now 001–013: 007–012 + 013 automation state FORWARD_FIX_REQUIRED post-data, 010 reversible-with-caution, 006 SAFE).

## Security Status

SAST = audit + secret scan + syntax gates (semgrep placeholder). SBOM generator present. Container non-root asserted. Findings register in THREAT-MODEL.md. No critical/high unresolved exploitable findings known at scan level; deep SAST (§49) pending.

## Provider Status

| Provider | Auth | Catalog | Publishing | Analytics | Last verified | State |
|---|---|---|---|---|---|---|
| TikTok Shop | signed SDK + OAuth PKCE persisted | sandbox/mocked | boundary + capability states | mocked exports | 2026-08-30 (`tiktok-sandbox-probe.mjs` → `open-api.tiktokglobalshop.com` 403 code 40006) | sandbox-only (affiliate product not enabled on legacy AppKey) |
| Shopee | HMAC client | n/a | n/a | webhook conversions | 2026-08-24 | sandbox-only |
| Lazada | signed client | n/a | n/a | n/a | 2026-08-24 | sandbox-only |
| Meta | absent | absent | boundary only | absent | never | not production-ready |
| YouTube | absent | absent | boundary only | absent | never | not production-ready |

Only mock/sandbox capabilities may be claimed. No live catalog/publish capability is production-ready (credential blocker B2; TikTok signature path verified working, product enablement remains).

## Operational Status

Observability active (/metrics, structured logs with redaction, SLO eval). Runbooks present (OPERATIONS.md + docs/operations + handbooks `docs/{operator,developer}/*`). Self-host operator path (`compose.selfhost.yaml` + `.env.selfhost`) validated live on `zaffiliate-selfhost-*` (postgres:17 healthy on 31 tables, 12/12 migrations applied). Affiliate runtime outbox dispatched via `outbox-dispatcher.js` (claim→publish→mark, retryable release); restore-into-clean rehearsal evidenced (B5). Backup drill runs in CI (`scripts/backup-restore-drill.mjs`).

## Blocking Issues (evidence-backed)

| ID | Blocker | Severity | Status |
|---|---|---|---|
| B1 | CI red on main: dedupe clock-mixing time bomb (duplicate-event gate) + fresh-checkout ENOENT in migration writer | BLOCKER | CLOSED 2026-08-25 — GM-001 commit `531b69d`, CI green: https://github.com/cvsz/zaffiliate/actions/runs/32871141615 |
| B2 | Live provider credentials unprovisioned; no provider capability may be marked production-ready | BLOCKER | PARTIALLY RESOLVED 2026-08-26 — **TikTok Shop sandbox authorized**: test shop "Jjj test shop" (ID) granted exactly `seller.affiliate_collaboration.read/write` (tokens stored gitignored server-side). App-review readiness package shipped: public `/privacy` + `/terms` with brand icon/favicon + no-login footer, disconnect/revoke endpoint returning deletion receipt, `docs/TIKTOK-APP-REVIEW.md` reviewer checklist, `docs/TIKTOK-SANDBOX-DEMO.md`. Remaining for TikTok: URL ownership verification, demo recording, final approval, **Shop Partner AppKey/AppSecret with the affiliate product enabled** (probed 2026-08-26 via `scripts/tiktok-sandbox-probe.mjs`: signed request reached open-api.tiktokglobalshop.com → 403 code 40006 "no schema found" with the legacy zeaz pair — that app lacks the affiliate product; signature path itself verified working end-to-end). Shopee/Meta/YouTube credentials still unprovisioned |
| B3 | PublicationJob durable persistence (MM-003 remainder); idempotent publish/retry/DLQ must survive restart | BLOCKER | CLOSED 2026-08-25 — GM-002 commit `6a17bc9`, CI green: https://github.com/cvsz/zaffiliate/actions/runs/32874226709 |
| B4 | OAuth browser flow + token refresh missing; REAUTH_REQUIRED lifecycle unimplementable | HIGH | CLOSED 2026-08-25 — GM-B4 slice: `packages/security/src/oauth.js` (authorization-code + PKCE S256, injectable transport/clock, typed fail-closed errors), token store over `ref:` manager with rotation + revocation→REAUTH_REQUIRED, server routes `/api/v1/oauth/:provider/{authorize,callback}` (single-use state, 503 when unconfigured), identity-link binding via `linkExternalIdentity`, audited `OAUTH_LINK_COMPLETED`; 13 tests RED→GREEN |
| B5 | Restore-into-clean-environment rehearsal + migration rollback classification not evidenced (§41/42/56) | HIGH | CLOSED 2026-08-25 — GM-B3 slice `restore-rehearsal.mjs`: live Supabase dump (`gm-b5-source-dump` sha256 `57d6e819…`; app-scope secret-free archive sha256 `cc9a9563…`) restored into isolated postgres:17; migration 006 applied forward onto restored snapshot (pending=0 drift=0); RLS 13/13 enabled+forced; cross-tenant read+write isolation proven through a dedicated non-owner app role; golden publication flow + golden financial metrics passed; per-migration rollback classification documented in `db/migrations/ROLLBACK.md`. Rehearsal findings fixed en route: `tenants` FORCE+policy (migration 006) and cross-call analytics-event dedupe crash |
| B6 | Distributed rate-limit store (Redis) pending; single-instance limiter only | MEDIUM | CLOSED 2026-08-26 — GM-B6 slice `packages/security/src/rate-limit-redis.js`: atomic Lua token bucket over an injectable Redis client (same optional-ioredis + REDIS_URL + memory-fallback pattern as the events bus — zero new dependencies), fail-closed degradation to enforced in-memory fallback on Redis outage (never fails open), cross-instance budget sharing proven at contract level, server 429 envelope w/ Retry-After over real HTTP; `createIngressRateLimiter` gained a `store` seam (default behavior unchanged). Production enablement: install ioredis + set REDIS_URL and inject the redis-backed limiter as the existing `rateLimiter` DI arg |
| B7 | Object storage writes fail-closed BLOCKED on bucket permissions | HIGH | open |
| B8 | Performance/load baselines not recorded against representative workloads (§43–47) | MEDIUM | CLOSED 2026-08-25 — `scripts/perf-baseline.mjs` vs isolated in-process production build (node 22): healthz 273rps p95=56ms · version 269rps p95=72ms · /go redirect 214rps p95=79ms · webhook ingest 212rps p95=76ms · analytics overview 320rps p95=63ms; saturation probe (healthz during webhook flood) p95=86ms err=0 — graceful degradation; soak 15s 100% success RSS +1.5%; live Supabase round-trip ~122–127ms warm. Evidence `dist/perf-baselines.json`. Dev-class single-process numbers; re-baseline on prod host before §90 |
| B10 | Operator/developer handbooks incomplete (§83/84) | LOW | CLOSED 2026-08-25 — `docs/operator/` (getting-started, daily-operations, campaign-operations, publishing, provider-health, automation, financial-reconciliation, incident-response) + `docs/developer/` (local-setup, architecture, testing, migrations, provider-adapters, ai-pipeline, queues, debugging, release-process); grounded in real commands/files |
| B9 | Full-chain multi-tenant golden E2E over HTTP (org A vs B, §10) not assembled end-to-end | HIGH | CLOSED 2026-08-25 — GM-B9 slice `test/multi-tenant-golden-e2e.test.js`: both tenants driven in parallel over real HTTP — disjoint commerce offers, indistinguishable cross-tenant/unknown `/go` 404s, foreign-tenant subId attribution rejected (422) while own attribution succeeds exactly once despite replays (runtime outbox single conversion, none for B), per-tenant analytics/commission totals never bleed under interleaved reads, automation policy PUT for A leaves B on default, recommendation records partitioned end-to-end |

## Approval

Not approved for Gold Master. B1, B3, B4, B5, B6, B8, B9, B10 closed with recorded evidence. Remaining: **B2** (external provider credentials — maintainer: TikTok Shop Partner AppKey/AppSecret with affiliate product enabled; current probe 40006 `no schema found` proves signature is valid and product is the blocker) and **B7** (Supabase S3 write-enabled keys — maintainer; probed 2026-08-26 → 403 on writes, hardened `content-validation.js`/`s3.js` gated correctly). Docs and syntax gates synchronized this slice (157 `node --check` gates, `ROLLBACK.md` 007–013, 595-test 589/6 baseline, publishing HTTP + trend + automation durable + MM-007 + Mission Control extended + k8s minimal). Once B2/B7 land, remaining work is provider live-verification slices, then the §94 checklist review and explicit §90 deployment authorization.
