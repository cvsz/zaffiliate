# Contributing to zaffiliate

`zaffiliate` is the canonical affiliate-commerce platform for the consolidated legacy stack. Contributions must preserve tenant isolation, security boundaries, migration provenance, rollbackability, and production evidence.

## Development workflow

1. Create a focused branch from `main` using `feat/`, `fix/`, `security/`, `docs/`, `refactor/`, `test/`, or `chore/`.
2. Map the change to `EXEC-PLANNING.md` and identify affected migration/provenance evidence.
3. Add or update tests, including negative tenant/security cases where relevant.
4. Run deterministic test/build/security checks and do not bypass failing gates.
5. Update architecture, operations, migration evidence, and `CHANGELOG.md` when applicable.
6. Open a pull request using the repository template and document rollback.

## Engineering requirements

- Browser/client code must never receive provider secrets.
- Tenant-owned data and mutations must remain tenant-bound and fail closed.
- External mutations require idempotency and approval/policy controls where specified.
- Durable financial state must preserve ledger invariants and auditability.
- Credentials, tokens, private keys, runtime `.env` files, and sensitive data must never be committed.
- Legacy code is migrated selectively with provenance; generated or unrelated baggage is not copied blindly.

## Commits

Prefer Conventional Commits, for example:

- `feat(ep07): add durable job replay guard`
- `security: harden webhook replay validation`
- `docs(migration): attach restore evidence`

## Pull requests

Every production-impacting PR should explain scope, source refs, validation, security impact, compatibility/data migration, observability, and rollback. Red CI, unresolved high/critical findings, tenant-boundary failures, or missing migration evidence are stop-the-line conditions.

## Security

Do not report exploitable vulnerabilities in public issues. Follow `SECURITY.md` and GitHub private security reporting where available.
