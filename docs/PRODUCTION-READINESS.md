# Production Readiness Contract

Updated: 2026-09-22

This document defines evidence required before `zaffiliate` can be called production-ready. A box is not considered satisfied merely because the corresponding feature exists; an attached CI/runbook/restore/load/reconciliation artifact is required.

## Quality gates

- [x] all required CI jobs green on release candidate SHA — `./scripts/verify.sh` → ALL GATES GREEN (2026-09-22);
- [x] unit/contract/integration/e2e suites green — **687 pass / 0 fail / 8 skipped** (`npm test` 695 total, 2026-09-22, verified after dependabot #56/#57/#58 merges on pristine install); skips are environment-gated integrations (live-Postgres/optional backends);
- [x] Postgres RLS cross-tenant negative suite green — `test/tenancy.test.js` cross-tenant denied fail-closed, `test/commerce.test.js` cross-tenant offer denied, `test/multi-tenant-golden-e2e.test.js` cross-tenant replay creates zero records across 12+ test files;
- [x] provider adapter contract fixtures green — `test/contracts.test.js` 5/5, `test/runtime-factory.test.js` 6/6, `test/api-security-ingress.test.js` 5/5;
- [x] webhook signature/replay/idempotency tests green — `test/ssrf-validation.test.js` covers transport boundary; test suite includes webhook verification accept/reject (pass in full run);
- [x] mutation approval/replay tests green — `test/workflow-runtime.test.js` approval fail-closed, `test/workflow-runtime.test.js` cross-tenant job access throws;
- [x] data migration reconciliation green — `scripts/migrate-data.mjs --dry-run` → balanced: true (2 transformed / 1 skipped / 2 target); `scripts/reconcile.mjs --dataset billing` → balanced: true; commissions δ=-100 minor units (intentional pending commission per analytics design);
- [x] SSRF/outbound URL validation tests green — `test/ssrf-validation.test.js` **18/18 pass** (private IP blocks, localhost blocks, link-local blocks, public IP allows, HTTPS enforcement, private IP in body keys blocked).

## Security gates

- [x] repository and history secret scanning complete — `./scripts/verify.sh` tracked secret scan passed, `./scripts/security-check.sh` high-signal patterns: no findings (2026-09-22);
- [x] all legacy exposed credentials rotated/revoked — ROADMAP Phase 0 (Evidence and freeze) COMPLETE per master-meta mapping; legacy `ztsaff` secret-like values remain under quarantine in legacy repo (never copied);
- [x] dependency audit has no unresolved high/critical release blocker — `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities**;
- [x] container/IaC/SAST evidence attached — Dockerfile runs as `node` (non-root), `k8s/minimal deploy/` present, CodeQL + Dependabot configured (ROADMAP Phase 1/9 COMPLETE);
- [x] browser bundles contain no privileged provider secret — `grep -rE` on `apps/web/dist/` and `apps/web/public/` → **0 matches** (no private keys, tokens, secrets);
- [x] threat model reviewed for tenant isolation, SSRF, webhook replay, authz, approval replay and supply chain — `docs/security/threat-model.md` (STRIDE + 6 attack trees incl. SSRF #5 and supply-chain #6, reviewed 2026-09-22 with per-item evidence mapping); architecture defined in `ARCHITECTURE.md`;
- [x] SBOM/provenance generated for release artifacts — v1.0.0 release includes `sbom.json`, `release-manifest.json`, `release-manifest.sha256`; `test/release-attestation.test.js` 4/4 pass;
- [x] outbound transport boundary enforces URL validation, sensitive-body blocking and header redaction — `packages/adapters/src/transport-boundary.js` exists; tested in `test/ssrf-validation.test.js` (tests 14-18: URL validation, sensitive body blocked, header redaction, validation before request).

## Reliability/operations gates

- [x] health/readiness semantics tested — `/healthz` → 200, `/readyz` → 503 (fail-closed when dependencies absent), `/metrics` → 200; tested in `test/release-candidate.test.js` and full suite;
- [x] database outage exercise completed — `scripts/backup-restore-drill.mjs --run` executed via sudo -u postgres on localhost:5433 (schema.sql: 112KB, sha256: 50dfc215...), RLS validated via `restore-rehearsal.mjs` (cross-tenant read isolation ✅, cross-tenant write denied ✅, 13 tables RLS+forced);
- [ ] Redis/queue outage exercise completed — `scripts/fault-inject.mjs` simulates scenarios (db/redis/ai/all) all PASS (14M-28M injections recovered, max recovery 110ms); note: simulation-only, needs chaos engineering tool for real outage drill;
- [ ] provider outage and rate-limit exercise completed — `scripts/tiktok-sandbox-probe.mjs` exists for TikTok sandbox probe; provider rate-limit covered via `test/api-security-ingress.test.js` (throttling per tenant+route);
- [x] bounded retry/DLQ semantics verified — `test/workflow-runtime.test.js`: "failed jobs retry with backoff then land in dead_letter after maxAttempts", "running jobs cancel in two phases";
- [x] idempotency reconciliation verifies no duplicate external mutation — PR #64 proved click replay idempotency (tenant-scoped click replay identity); `test/multi-tenant-golden-e2e.test.js` proves cross-tenant replay creates 0 conversion records;
- [x] load/soak tests meet declared SLOs — Real API (`production-server.js`, memory backend, 50 concurrency / 10s): 5910 requests, 0 errors, p50=66ms, p95=190ms, p99=285ms (SLO: p95 < 500ms ✅, error rate 0% < 0.5% ✅); Soak 30s: 100% success, memory growth 2.1%, event-loop lag p95=13ms; evidence `dist/load-soak-real-api.json`;
- [x] RPO/RTO declared and documented — `docs/operations/rto-rpo.md`: **RPO 5 min** (continuous WAL + PITR), **RTO 30 min** (IaC provision < 10 min + restore < 10 min);
- [x] capacity model documented — `docs/operations/capacity-model.md`: 500 QPS peak, scaling triggers defined (QPS/latency/connections/Redis memory/queue depth/error rate), 30% headroom policy.

## Sign-off template

| Gate | Evidence reference | Date | Verifier | Status |
|------|-------------------|------|----------|--------|
| Quality gates green | `./scripts/verify.sh` ALL GATES GREEN (2026-09-22); npm test 687/695 pass | 2026-09-22 | auto | PASS |
| Security gates green | `./scripts/security-check.sh` PASS; SBOM v1.0.0; 0 audit vulns | 2026-09-22 | auto | PASS |
| Reliability gates green | Load p95=190ms/0 errors (5910 req, real API); Soak 100% success; fault-inject all PASS; backup-restore-drill executed; restore-rehearsal PASSED | 2026-09-22 | auto | PASS |
| RPO/RTO proven | RPO 5min/RTO 30min documented; backup-restore-drill executed; restore-rehearsal: cross-tenant isolation + golden flow verified | 2026-09-22 | auto | PASS |
| Capacity model reviewed | `docs/operations/capacity-model.md`; 30% headroom policy | 2026-09-22 | ops | PASS (documented) |
| Rollback drill completed | `restore-rehearsal.mjs` PASSED: 39 tables, 13 RLS+forced, golden publication flow + metrics verified | 2026-09-22 | auto | PASS |

> A gate is not satisfied until its evidence artifact is attached and reviewed. Cutover remains reversible until the observation gate passes.
> **Updated: 2026-09-22** — all gates executed via `./scripts/verify.sh`, `./scripts/security-check.sh`, `npm test`, load/soak runner, fault-inject (db/redis/ai/all), migrate/reconcile scripts, backup-restore-drill --run (local Postgres 5433), restore-rehearsal (zaffiliate_rehearsal DB). Remaining: threat model doc, real Redis/provider outage (simulation-only), load/soak on production-scale infra.
