# Production Readiness Contract

Updated: 2026-08-22

This document defines evidence required before `zaffiliate` can be called production-ready. A box is not considered satisfied merely because the corresponding feature exists; an attached CI/runbook/restore/load/reconciliation artifact is required.

## Quality gates

- [ ] all required CI jobs green on release candidate SHA;
- [ ] unit/contract/integration/e2e suites green;
- [ ] Postgres RLS cross-tenant negative suite green;
- [ ] provider adapter contract fixtures green;
- [ ] webhook signature/replay/idempotency tests green;
- [ ] mutation approval/replay tests green;
- [ ] data migration reconciliation green;
- [ ] SSRF/outbound URL validation tests green (`test/ssrf-validation.test.js`).

## Security gates

- [ ] repository and history secret scanning complete;
- [ ] all legacy exposed credentials rotated/revoked;
- [ ] dependency audit has no unresolved high/critical release blocker;
- [ ] container/IaC/SAST evidence attached;
- [ ] browser bundles contain no privileged provider secret;
- [ ] threat model reviewed for tenant isolation, SSRF, webhook replay, authz, approval replay and supply chain;
- [ ] SBOM/provenance generated for release artifacts;
- [ ] outbound transport boundary enforces URL validation, sensitive-body blocking and header redaction (`packages/adapters/src/transport-boundary.js`).

## Reliability/operations gates

- [ ] health/readiness semantics tested;
- [ ] database outage exercise completed;
- [ ] Redis/queue outage exercise completed;
- [ ] provider outage and rate-limit exercise completed;
- [ ] bounded retry/DLQ semantics verified;
- [ ] idempotency reconciliation verifies no duplicate external mutation;
- [ ] load/soak tests meet declared SLOs;
- [ ] RPO/RTO declared and documented (`docs/operations/rto-rpo.md`);
- [ ] capacity model documented (`docs/operations/capacity-model.md`).

## Sign-off template

| Gate | Evidence reference | Date | Verifier | Status |
|------|-------------------|------|----------|--------|
| Quality gates green | CI run SHA + artifact links | | | Pending |
| Security gates green | SAST/secret-scan/attestation artifacts | | | Pending |
| Reliability gates green | load-test report + drill runbook results | | | Pending |
| RPO/RTO proven | restore-drill report | | | Pending |
| Capacity model reviewed | ops review + scaling triggers verified | | | Pending |
| Rollback drill completed | rollback drill report + verified artifact | | | Pending |

> A gate is not satisfied until its evidence artifact is attached and reviewed. Cutover remains reversible until the observation gate passes.
