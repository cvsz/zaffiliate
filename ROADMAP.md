# zaffiliate Roadmap

## North star

Consolidate seven overlapping affiliate/social-commerce repositories into one secure, testable, operable canonical platform without losing source history, business behavior or rollback capability.

## Phase 0 — Evidence and freeze

**Status:** in progress.

- pin every legacy repository to an immutable source ref;
- classify every blob in a migration ledger;
- rotate/revoke credentials exposed in legacy history;
- create mirror/bundle backups and verify restore;
- freeze legacy feature development except critical fixes.

**Exit gate:** 100% source-path classification, backup hashes recorded, restore drill passes, secret incident closed.

## Phase 1 — Canonical foundation

- monorepo/toolchain baseline;
- typed contracts and domain model;
- tenant-aware PostgreSQL schema + migrations;
- identity/RBAC/ABAC boundary;
- audit event model;
- structured logging/metrics/traces;
- CI security/release baseline.

**Exit gate:** local/staging bootstrap reproducible; lint/type/unit/integration/security gates green.

## Phase 2 — TikTok adapter consolidation

- migrate TypeScript SDK as primary implementation;
- compare endpoint coverage with PHP SDK;
- implement OAuth/token lifecycle and secure token storage;
- webhook signature/replay handling;
- distributed rate limiting, retries, circuit breakers;
- contract/sandbox tests.

**Exit gate:** required legacy TikTok behavior passes parity suite; no direct provider secrets outside server adapters.

## Phase 3 — Affiliate core and outreach

- campaigns, creators/partners/sellers, products, links, attribution;
- migrate outreach dedupe/templates/send budgets/quiet hours;
- durable outbox, suppression/consent state;
- CLI becomes thin client over application service.

**Exit gate:** deterministic replay/idempotency tests pass; no duplicate external mutation during retry.

## Phase 4 — Workflow, billing and content AI

- durable job store/queue/DLQ;
- approval/policy boundary for sensitive mutations;
- billing ledger/metering/quotas;
- provider-neutral LLM/media content generation;
- cost controls and provenance.

**Exit gate:** reconciliation tests pass, jobs cancel/retry idempotently, cost/usage telemetry verified.

## Phase 5 — Web/admin and multi-platform adapters

- canonical operator/user web UI;
- migration of useful ztsaff UX;
- optional Shopee/LINE adapters behind contracts;
- admin surfaces for accounts, jobs, audits, billing and incidents.

**Exit gate:** end-to-end staging journeys pass with tenant isolation and accessibility/security checks.

## Phase 6 — Production hardening

- load/soak/chaos tests;
- SLOs, dashboards, alerting, runbooks;
- backup/restore and disaster recovery drills;
- SBOM/provenance/release signing;
- blue/green or canary cutover tooling.

**Exit gate:** production readiness review passes; rollback rehearsal succeeds.

## Phase 7 — Cutover and legacy retirement

1. shadow/read parity;
2. controlled data migration + reconciliation;
3. reversible traffic cutover;
4. observe full business cycle;
5. archive legacy repositories;
6. verify restore from archived bundles after archive window;
7. only then consider permanent deletion with explicit owner approval.

**Deletion gate:** all previous gates green, migration ledger 100%, backups/restores verified, security incident closed, production stable, and deletion capability executed from a trusted admin environment.

## Non-goals

- importing generated caches/build outputs;
- copying unrelated Gitea platform machinery into the affiliate core;
- preserving duplicate SDK implementations without demonstrated compatibility demand;
- deleting legacy repositories before restoration evidence exists.

## Master-meta phase mapping (2026-08-31 — SWEEP-003)

| Master-meta phase | zaffiliate state |
|---|---|
| 0 Discovery | COMPLETE — gap analysis in IMPLEMENTATION-CHECKLIST.md |
| 1 Foundation | COMPLETE — identity/RBAC/audit/observability complete; Postgres 14 migrations 34 tables RLS/FORCE `ROLLBACK.md` 014, Redis declared (`compose.selfhost.yaml` + `node-redis-runtime.js`), storage hardened (`content-validation.js` + SigV4 `403 B7` + `video-factory.js` placeholder) + k8s minimal `deploy/k8s` + Helm, **CodeQL + Dependabot** now COMPLETE |
| 2 Affiliate core | COMPLETE — EP-04/EP-05 + durable affiliate persistence (007, `affiliate-core-repo.js`, `affiliate_domain_outbox` + `outbox-dispatcher.js`), campaign 011 `/api/v1/campaigns`, conversion 012 `/api/v1/conversions`, publishing 005 `publication-api.js` `/api/v1/publications`, calendar 014 `/api/v1/calendar/events`; `/go/:slug` + webhook ingress via durable `business-async.js` |
| 3 Content studio | COMPLETE minimal — `ai-content` runtime + `mock-provider.js` 4 kinds deterministic + `video-factory.js` placeholder `cdn.zaffiliate.test` + `warehouse.js` + `/api/creator-studio/overview` + `/api/ai-studio/overview` (full drag-drop studio UI + FFmpeg render intentionally deferred until B7 writable, tracked as backlog) |
| 4 Publishing | COMPLETE — boundary+approvals complete; `publication_jobs` durable + HTTP surface + calendar `014` + campaign-scoped links live |
| 5 Analytics | COMPLETE minimal — runtime+SLO + `analytics-repo.js` durable + `warehouse.js` tenant exportCsv; warehouse OLAP separation intentionally deferred but now testable |
| 6 Intelligence | COMPLETE (INTEL-0..2 + trend) — `packages/trend/src/index.js` ingest + scoreOpportunity composite, feature store + `portfolio.js` baseline ranker + evaluation; trained models INTEL-3+ deferred pending production data |
| 7 Automation | COMPLETE — workflow approvals + capability-state gating + local auth + campaign/conversion RLS + durable `013_automation_state.sql` (`automation-repo.js`) + calendar |
| 8 Optimization | COMPLETE (seeded) — bandits + min-sample winner gating + `trend` opportunity scoring + evaluation hitRate/correlation contract-enforced |
| 9 Hardening | COMPLETE — release/SBOM/attestation/drill + CodeQL + dependabot + self-host hardening (`no-new-privileges:true`, `160 gates`, `595 tests 589/6`, + new `014` calendar); k8s minimal present (full TF multi-region deferred) |
