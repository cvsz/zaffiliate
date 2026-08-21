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
