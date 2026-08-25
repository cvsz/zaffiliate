# Closure Package

Updated: 2026-08-22

This directory contains the complete closure package for the 4 remaining external blockers in EXEC-PLANNING.md. These items cannot be completed from the repository alone; they require real external actions by the maintainer.

## Remaining blockers

1. EP-01: Legacy credential rotation (legacy provider admin consoles)
2. EP-11: Production infrastructure validation (load/soak/fault/backup-restore against real infra)
3. EP-11B: Maintainer GPG-signed attestation (GPG private key)
4. EP-12/12B/13: Reversible production cutover + final release + legacy retirement (production traffic + GitHub admin)

## Execution order

```
EP-01 (credential rotation)
  -> EP-11 (production harness execution)
    -> EP-12 (cutover simulation + SLO watch)
      -> EP-12B (release candidate + smoke)
        -> EP-13 (legacy retirement)
          -> EP-11B (GPG attestation of final release baseline)
```

EP-11B GPG attestation is listed last because it attests the final immutable release baseline after all other gates are green.

## Documents

- `README.md` — this file
- `execution-plan.md` — master execution plan with pre-flight checklist, evidence template, stop-the-line escalation, sign-off blocks
- `ep01-credential-rotation.md` — per-provider credential rotation runbook
- `ep11-production-execution.md` — production infrastructure execution plan
- `ep11b-gpg-attestation.md` — maintainer GPG attestation runbook
- `ep12-13-cutover-retirement.md` — cutover, final release, and legacy retirement runbook

## Pre-flight checklist

- [ ] All local tests pass (`npm test` — 233/233)
- [ ] All syntax checks pass (`npm run check`)
- [ ] CI green on main for all jobs
- [ ] Backup/restore drill completed successfully (dry-run or live)
- [ ] Legacy repositories still intact and accessible
- [ ] Owner approval recorded for each external action
- [ ] Evidence directory (`docs/closure/evidence/`) created and writable

## Evidence collection

For each step, record:
- Command executed
- Expected output
- Actual output
- Status (pass/fail/blocked)
- Timestamp
- Verifier name

Store evidence as files in `docs/closure/evidence/` with deterministic naming:
- `ep01-rotation-<provider>-<date>.json`
- `ep11-harness-<gate>-<date>.json`
- `ep11b-gpg-<date>.json`
- `ep12-cutover-<phase>-<date>.json`
- `ep13-retirement-<stage>-<date>.json`

## Stop-the-line conditions

Stop all closure activity and escalate to maintainer if:
- Any credential rotation breaks production traffic
- Cross-tenant access failure detected during production harness
- Authorization bypass detected
- Ledger/reconciliation mismatch > 0
- Lost or duplicate external mutation
- Webhook replay/reconciliation failure
- Backup/restore drill fails
- Unresolved critical/high security finding
- Red CI on main
- Inability to roll back

## Sign-off template

```
EP: <ep-number>
Closure item: <description>
Date: YYYY-MM-DD
Verifier: <name>
Evidence references: <file paths>
Status: PASS | FAIL | BLOCKED
Notes: <optional>
```
