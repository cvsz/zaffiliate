# zaffiliate Execution Planning

## Execution contract

Work proceeds as vertical slices. Each slice must include code, migrations/contracts, tests, security review, observability, rollback notes and evidence. No legacy repository is deleted as part of an implementation slice.

## EP-00 — Complete migration ledger

- enumerate every blob from each pinned legacy snapshot;
- assign classification and canonical destination/drop reason;
- record blob SHA and validation status;
- detect duplicate blobs/content and generated artifacts;
- export branch/tag/issue/PR/release inventory;
- create mirror/bundle backups and verify them.

**Done when:** 100% blobs classified; no unresolved source path; backup/restore evidence exists.

## EP-01 — Security incident closure

- rotate/revoke ztsaff tracked secret-like values and any reused credentials;
- scan all seven repos including history;
- remove runtime `.env` from canonical imports;
- establish secret-manager contract and redaction tests.

**Done when:** zero active credentials originate from tracked legacy secret material and scanning is green.

## EP-02 — Workspace bootstrap

- root package/workspace config;
- formatting/lint/type/test commands;
- Postgres/Redis local stack;
- migration framework;
- CI with SAST/SCA/secret/IaC/container scans;
- SBOM/provenance artifact generation.

## EP-03 — Contracts + tenancy

- tenant/account/user/resource identifiers;
- API/event schemas;
- DB row ownership policy;
- authorization decision API;
- append-only audit contract.

**Tests:** cross-tenant negative tests are mandatory.

## EP-04 — TikTok adapter

- migrate endpoint models from TS SDK;
- map PHP resource parity;
- OAuth/signing/token refresh;
- pagination, rate limits, retries, errors;
- webhook signature/replay verification;
- sandbox contract tests.

**Done when:** required endpoint parity matrix is green and PHP-only behavior is either ported or explicitly retired.

## EP-05 — Affiliate core

- campaigns/creators/partners/sellers/products/links;
- normalized platform identifiers;
- attribution/analytics interfaces;
- transaction boundaries and audit emission.

## EP-06 — Outreach

- port dedupe/templates/quiet-hour/budget semantics;
- provider interface and durable outbox;
- consent/suppression state;
- delivery status + retry/DLQ;
- CLI as thin API client.

**Specific repair:** replace the missing `src.utils` dependency from `tiktok-shop-bot` with canonical utility/provider interfaces and tests.

## EP-07 — Durable workflow

- job state machine;
- idempotency store;
- policy/approval hooks;
- bounded retry/cancel/replay;
- queue workers + DLQ;
- trace/audit propagation.

## EP-08 — Identity and billing

- secure user/session lifecycle;
- RBAC/ABAC;
- plan/quota model;
- reconcilable ledger and metering;
- admin bootstrap disabled after provisioning.

## EP-09 — Content AI

- provider-neutral text/media generation;
- prompt/template versioning;
- cost budgets and metering;
- safety and tool policy;
- deterministic request provenance.

## EP-10 — Web/admin

- operator and affiliate workflows;
- account/connect/disconnect;
- campaigns/products/creators;
- jobs/content/outreach;
- billing/audit/incident surfaces;
- strict server-side secret boundary.

## EP-11 — Production validation

- unit/integration/contract/e2e suites;
- load/soak tests;
- fault injection for provider/queue/DB failure;
- backup/restore drill;
- alert/runbook exercise;
- migration reconciliation and shadow parity.

## EP-12 — Cutover

- freeze legacy mutations;
- final data sync;
- validate counts/checksums/business totals;
- enable canonical path progressively;
- maintain reversible routing;
- monitor SLO/error budgets and billing/webhook reconciliation.

## EP-13 — Retirement

- archive legacy repos;
- retain immutable bundles/manifests;
- run restore drill from retired artifacts;
- observe agreed archive window;
- request explicit owner approval for permanent deletion.

## Mandatory PR evidence

Each PR records: scope, source refs, migrated blob ledger rows, tests run/results, security impact, schema/API compatibility impact, telemetry added, rollback method and unresolved gaps.

## Stop-the-line conditions

Stop cutover/retirement on: secret exposure, tenant-boundary failure, ledger mismatch, lost/duplicate platform mutation, webhook reconciliation failure, inability to restore backup, unresolved high/critical security finding, red CI, or undocumented source blobs.
