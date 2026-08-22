# Production Readiness Contract

Updated: 2026-08-22

This document defines evidence required before `zaffiliate` can be called production-ready. A box is not considered satisfied merely because the corresponding feature exists; an attached CI/runbook/restore/load/reconciliation artifact is required.

## Application quality

- [ ] all required CI jobs green on release candidate SHA;
- [ ] unit/contract/integration/e2e suites green;
- [ ] Postgres RLS cross-tenant negative suite green;
- [ ] provider adapter contract fixtures green;
- [ ] webhook signature/replay/idempotency tests green;
- [ ] mutation approval/replay tests green;
- [ ] data migration reconciliation green.

## Security

- [ ] repository and history secret scanning complete;
- [ ] all legacy exposed credentials rotated/revoked;
- [ ] dependency audit has no unresolved high/critical release blocker;
- [ ] container/IaC/SAST evidence attached;
- [ ] browser bundles contain no privileged provider secret;
- [ ] threat model reviewed for tenant isolation, SSRF, webhook replay, authz, approval replay and supply chain;
- [ ] SBOM/provenance generated for release artifacts.

## Reliability

- [ ] health/readiness semantics tested;
- [ ] database outage exercise completed;
- [ ] Redis/queue outage exercise completed;
- [ ] provider outage and rate-limit exercise completed;
- [ ] bounded retry/DLQ semantics verified;
- [ ] idempotency reconciliation verifies no duplicate external mutation;
- [ ] load/soak tests meet declared SLOs.

## Data protection and disaster recovery

- [ ] production backup policy defined;
- [ ] encrypted backups verified;
- [ ] seven legacy repo mirror backups verified;
- [ ] seven legacy repo bundles verified with `git bundle verify`;
- [ ] SHA-256 backup manifest stored;
- [ ] clean restore drill completed;
- [ ] RPO/RTO declared and demonstrated.

## Observability

- [ ] structured logs with tenant/request/trace correlation and secret redaction;
- [ ] metrics for request rate/errors/latency, jobs, queue depth, provider errors, webhooks, billing reconciliation and AI spend;
- [ ] distributed traces for API -> workflow -> provider path;
- [ ] dashboards created;
- [ ] paging alerts and runbooks linked;
- [ ] SLO/error-budget policy approved.

## Release and rollback

- [ ] immutable release manifest;
- [ ] release candidate SHA recorded;
- [ ] signed commit/tag produced from trusted local GPG environment;
- [ ] deploy smoke/e2e green;
- [ ] rollback artifact retained and rollback drill completed;
- [ ] post-deploy reconciliation green;
- [ ] production cutover remains reversible until observation gate passes.

## Retirement gate

Legacy repository retirement is forbidden until every EP-00..EP-12 hard gate is satisfied. Permanent deletion additionally requires archive observation and explicit owner approval immediately before deletion.
