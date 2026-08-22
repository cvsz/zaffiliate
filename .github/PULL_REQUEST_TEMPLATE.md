## Summary

Describe what changed and why.

## Execution-plan mapping

- EP / milestone:
- Source provenance / migration ledger rows (if applicable):

## Validation

- [ ] Tests added or updated where needed.
- [ ] Formatting/linting completed.
- [ ] Build completed where applicable.
- [ ] CI/security gates are green.
- [ ] Cross-tenant negative tests considered where applicable.
- [ ] Documentation and migration evidence updated where needed.

## Security / compatibility / operations

Describe tenant-boundary impact, secrets handling, API/schema compatibility, idempotency, observability, deployment risk, and data-migration requirements.

## Rollback

Describe the exact rollback or forward-fix procedure. State whether any external side effects or irreversible data migrations are introduced.

## Checklist

- [ ] This pull request is focused and reviewable.
- [ ] No credentials, tokens, private keys, or sensitive data are included.
- [ ] Security/quality gates were not weakened or bypassed.
- [ ] Mutating provider operations have approval/idempotency safeguards where required.
- [ ] User-visible changes are reflected in `CHANGELOG.md` where appropriate.
- [ ] This change does not claim migration/cutover/retirement completion without evidence.
