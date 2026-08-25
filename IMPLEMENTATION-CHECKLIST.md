# zaffiliate Gap Analysis vs Master Meta Architecture

Updated: 2026-08-25 · Evidence base: `npm test` 471 tests — 470 pass, 0 fail, 1 gated skip; `npm run check` clean; slice records in `exec-planning.md`; release decision in `RELEASE-READINESS.md`.

## Classification legend

COMPLETE · PARTIAL · MISSING · BLOCKED · DEFERRED

## Capability matrix

| # | Capability (master meta §) | Status | Evidence / gap |
|---|---|---|---|
| 1 | Monorepo + zero-dep runtime (§2) | COMPLETE | single-package ESM monorepo, `node --test`, CI in `.github/workflows/ci.yml` |
| 2 | Tenancy, RBAC, audit chain (§24) | COMPLETE | `packages/contracts/src/{tenancy,grants,audit}.js`, RLS tests `db/tests/rls.sql`, escalation audit |
| 3 | Identity: sessions, API keys, plans, ledger (§24) | COMPLETE | `packages/identity-billing/*`; time-bomb test fixed this slice |
| 4 | OAuth/OIDC browser flow, PKCE, JWKS | MISSING | only API-key + external identity links; no password/OIDC login yet |
| 5 | Affiliate lifecycle P→O→L→click→conversion→commission (§3) | COMPLETE | `packages/affiliate-core/*`, immutable minor-unit snapshots, outbox |
| 6 | Provider adapters TikTok/Shopee/Lazada/Meta/YouTube/LINE (§3) | PARTIAL | TikTok full SDK (`packages/tiktok-shop`); Shopee/Lazada signed clients; Meta/YT = publishing boundary only; no catalog/order reads for Meta/YT |
| 7 | Provider capability states manual/approval-required/unsupported (§1) | COMPLETE (this slice) | `packages/adapters/src/provider-registry.js` + `test/provider-capability.test.js` (10 tests) |
| 8 | Normalized domain model w/ validation (§3) | COMPLETE (this slice) | `packages/contracts/src/schema.js` + `test/domain-schema.test.js` (14 tests) |
| 9 | Webhook ingress + durable events (§30) | COMPLETE | ingress live + canonical envelopes; canonical envelopes durably persisted to live analytics_events (MM-003-lite evidence); replay-dedupe clock-mixing defect fixed in GM-001 with frozen-clock regressions (injectable store clock) |

| 10 | Workflow engine: grants, DLQ, approvals, reconciliation (§18) | COMPLETE | `packages/workflow/*` |
| 11 | Outreach engine (consent, quiet hours, budgets) (§11) | COMPLETE | `packages/outreach/*` |
| 12 | AI content runtime: providers, budgets, moderation, agents (§7) | PARTIAL | `packages/ai-content/*` has LLM/image/video/voice interfaces, bandit experiments; no real provider bindings (BLOCKED on credentials), no FFmpeg render (DEFERRED) |
| 13 | Video factory / media pipeline (§9) | DEFERRED | interfaces only; rendering architecture not started |
| 14 | Publishing orchestrator w/ publication_jobs state machine (§12) | PARTIAL | approval+idempotency boundary exists; durable job queue with retry/DLQ states lives only in workflow pkg; unified PublicationJob entity added to contracts this slice, persistence pending |
| 15 | Link service `/go/:slug` + click attribution (§14) | COMPLETE | `GET /go/:slug` in apps/api: tenant-gated, HTTPS re-validated, expiry-aware, hashed-visitor attribution (MM-002 evidence) |
| 16 | Analytics: metrics, SLO, anomaly (§15) | PARTIAL | `packages/analytics` + `/metrics` + SLO eval; warehouse/OLAP separation absent |
| 17 | Trend & opportunity scoring engine (§4–5) | MISSING | no trend ingestion or opportunity scoring module |
| 40 | Event bus + storage foundation (MM-005-lite/MM-006/SEC-008-lite) | PARTIAL | bus w/ retry+DLQ; media validation + local driver + signed URLs + SigV4 S3 driver live (write BLOCKED on bucket permissions — provider-side); Redis streams publisher live w/ memory fallback |

| 41 | JWKS/OIDC verification (MM-004 foundation) | PARTIAL | RS256/JWKS client + verifier live and tested; browser authorize flow + PKCE endpoints remain |
| 39 | Intelligence foundation (ML-001..005/020..024/MLOPS-001..007/OPT-001..004) | COMPLETE for INTEL-0..2 scope | full loop live: features -> baseline ranker -> recommendations/predictions -> evaluation/explanation -> decision gate (policy+capability+commercial truth) -> audited outcomes. INTEL-3+ (shadow w/ real paired data, trained models) awaits production data |
| 38 | CSRF gate on web mutations (SEC-005b/§8) | COMPLETE | x-zaff-csrf + JSON content-type + Origin/host match on /api/workflow/approve, fail-closed 403s w/ regression suite |
| 37 | Ingress protection (SEC-021/022) | PARTIAL | keyed rate limiter + typed SecurityEvent recorder live on public routes; distributed store (Redis) + remaining event emitters pending |
| 36 | Mission Control UI foundation (UI-001/005/020-022) | PARTIAL | design tokens + severity system + /api/ui/overview KPI hierarchy + Critical Action Center live; remaining surfaces (revenue trend, integration/worker health panels) next |
| 35 | Offer intelligence foundation (COM-001..004+freshness) | PARTIAL | commerce.js: offer/price-snapshot/promotion models, freshness gate, stale-claim BLOCK engine, golden scenario — ingestion pipeline + claim binding/extraction next (COM-020+, COM-040+) |
| 34 | Measurement layer (DATA-001/002/003) | PARTIAL | canonical envelope + source classes + lineage + dedup + raw store + golden-metric fixtures landed; normalization/enrichment pipeline, attribution windows, commission ledger & reconciliation = next DATA slices |
| 33 | Automation policy plane (AUTO-001/002/003/007) | PARTIAL | packages/automation: policy model, typed decisions, evaluator chain, 6-scope kill switches, dry-run, audited denials — durable workflow state + shadow mode pending (AUTO-005/008) |
| 17b | Content Factory foundation (AFF-130/140/141/142/154) | COMPLETE | factory.js: persona library, evidence-gated briefs, scored hook engine w/ fail-closed claim rejection, versioned prompt registry, quality gate w/ hard compliance stops — evidence in exec-planning.md |
| 18 | Experimentation beyond seeded bandits (§17) | PARTIAL | bandit variant selection exists; min-sample winner gating added to contracts schema this slice |
| 19 | Postgres persistence of runtimes (§21) | PARTIAL | analytics_events durability PROVEN live end-to-end incl. migration 004 schema-drift resolution; remaining: offer/campaign store wiring (AFF-013 remainder) |
| 20 | Redis durable events (§20) | PARTIAL | in-memory outbox everywhere; compose provides Redis; streams bus not ported |
| 21 | Object storage / media assets (§9) | MISSING | no storage adapter package |
| 22 | Control-plane web SPA (§22–23) | PARTIAL | CSP-first surfaces for nav/audit/billing/workflow/outreach/analytics + approval endpoint; creator-studio/AI-studio views absent |
| 23 | Observability (§26) | COMPLETE | structured JSON logs w/ redaction, spans, MetricsRegistry, `/metrics`, alert/dashboard configs |
| 24 | Release engineering / SBOM / attestation (§28) | COMPLETE | `scripts/generate-{release-manifest,changelog,sbom}.mjs`, gpg attest, smoke/soak/load/fault-inject scripts |
| 25 | CI security gates (§28) | COMPLETE | secret scan + SSRF guards + syntax check + tests (`.github/workflows/ci.yml`) |
| 26 | Docker/compose local stack (§28) | COMPLETE | hardened `compose.yaml` + Dockerfile (read-only, no-new-privileges) |
| 27 | Kubernetes/Terraform/Helm (§28) | MISSING | not present; deploy currently via compose |
| 28 | Live platform credentials (all adapters) | BLOCKED | sandbox/production creds not provisioned in env; all live calls blocked, mocks used |

## Priority order (next bounded items)

1. **GM-001 closure**: push slice, record green CI run as release evidence (RELEASE-READINESS.md B1)
2. **MM-003 remainder / GM blocker B3**: durable PublicationJob persistence behind dev/prod toggle using `packages/db`
3. **MM-004 / GM blocker B4**: OAuth/OIDC browser flow + token refresh
4. **GM blocker B5**: restore rehearsal + per-migration rollback classification (§41/42/56)
5. **MM-005 / GM blocker B6**: Redis-backed distributed rate-limit store
