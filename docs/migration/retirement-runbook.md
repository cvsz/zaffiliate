# Legacy Retirement Runbook

## Stage 1: archive

- Freeze all seven legacy repositories (no new commits/tags).
- Preserve mirror/bundle/SHA manifests.
- Retain final HEAD/tag/ref inventory.
- Update links to canonical repository.
- Perform restore drill from retired artifacts.

## Stage 2: observation

- Run archive observation window.
- Verify no runtime/build/deployment dependency on legacy repos.
- Verify canonical production stability and reconciliation.

## Stage 3: permanent deletion

Allowed only after every hard gate is green and explicit owner approval is recorded immediately before deletion.

## Stop-the-line

- backup/restore drill fails
- canonical instability detected
- unresolved dependency on legacy artifacts
- missing owner approval
