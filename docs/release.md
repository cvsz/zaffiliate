# Release

Releases are evidence-gated and follow `EXEC-PLANNING.md`, `docs/PRODUCTION-READINESS.md`, `docs/SLO.md`, and migration evidence under `docs/migration/`.

## Release prerequisites

- CI, dependency review, CodeQL, tests, container checks, and required security scans are green.
- High/critical security findings are resolved or explicitly blocked from release.
- Database migrations have forward/rollback or forward-fix procedures and tenant isolation tests.
- Release evidence manifest and source provenance are generated and verified.
- Load/soak/fault/backup/restore gates are satisfied when required by the release stage.
- Production cutover remains reversible until reconciliation/SLO gates pass.

## Versioning

Use semantic versioning for stable releases. User-visible changes should be recorded in `CHANGELOG.md`.

## Signing and provenance

Automation-generated release manifests are not a substitute for maintainer GPG attestation. Final signed commit/tag operations requiring the maintainer private key must run in a trusted local Git environment.

## Rollback

Every release must identify the previous known-good artifact/configuration, database compatibility constraints, routing rollback procedure, and reconciliation steps for external mutations/webhooks/billing.
