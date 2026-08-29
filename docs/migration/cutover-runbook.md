# Cutover Runbook

## Phases

1. dry-run: validate routing rules, print intended changes, no mutation.
2. shadow: dual-write simulation, compare canonical vs legacy counts.
3. enable: flip routing flag, validate zero legacy mutation dependency.
4. rollback: revert routing flag, validate data integrity.

Command: `node scripts/cutover.mjs --phase=shadow`

Evidence: `dist/cutover-evidence.json`

## Stop-the-line

- routing flag flip fails
- dual-write count mismatch in shadow phase
- legacy dependency detected in enable phase
- rollback integrity check fails
