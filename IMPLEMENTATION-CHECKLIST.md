# zaffiliate Implementation Checklist

## Repository standards

- [x] Canonical architecture, security, operations, roadmap and execution plan exist.
- [x] CODEOWNERS, PR template, issue forms and dependency automation exist.
- [x] CI, CodeQL and dependency review workflows exist.
- [x] Development, release and ADR guidance exist.

## Product/runtime

- [x] Tenant contracts and Postgres RLS baseline.
- [x] TikTok adapter foundation and multi-channel capability boundary.
- [x] Affiliate lifecycle, outreach, durable workflow, billing, AI, analytics and web/admin baselines.
- [x] Observability, metrics and release evidence pipeline.

## Production completion gates

- [ ] 100% per-blob migration ledger classification for all seven legacy snapshots.
- [ ] Verified mirror and git-bundle backups for every legacy repository.
- [ ] SHA-256 backup/ref manifest and clean restore drill.
- [ ] Legacy credential rotation/revocation and historical secret scan closure.
- [ ] Provider-specific parity and live sandbox/controlled integration evidence.
- [ ] Load/soak/fault-injection evidence against SLO/error budgets.
- [ ] Production backup/restore and incident/runbook exercises.
- [ ] Reversible canary/cutover with business/webhook/billing reconciliation.
- [ ] Observation period completed without unresolved regression.
- [ ] Trusted-local GPG release attestation.
- [ ] Explicit owner approval before permanent legacy-repository deletion.

A checkbox may be marked complete only when evidence is linked or committed. `EXEC-PLANNING.md` remains the authoritative execution contract.
