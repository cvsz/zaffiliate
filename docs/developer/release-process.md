# Developer Handbook — Release Process

Source of truth: `RELEASE-READINESS.md` (decision + blockers). This file is the mechanical path.

## Cadence

1. **Bounded slice** → code + tests (RED→GREEN) + docs (`EXEC-PLANNING.md` record, `CHANGELOG.md`, checklist row) → commit (GPG-signed) → push.
2. **CI must be green on `main`** before anything else happens. Red main = stop the line.
3. **Evidence**: every blocker closure cites a commit + CI run URL in RELEASE-READINESS.

## Pre-release gates (master-spec §71)

Release candidate approval · CI green · security review (`scripts/security-check.sh`, `npm audit --omit=dev --audit-level=high`) · backup verified (`scripts/backup.sh` + restore rehearsal) · migration rehearsal (`restore-rehearsal.mjs` forward-applies onto restored snapshot) · rollback documented (`db/migrations/ROLLBACK.md`) · providers healthy enough for scope.

## Deploying to the host

```sh
scripts/deploy-host.sh        # idempotent: api systemd unit + tunnel + edge vhost + migrations
```

Post-deploy: `/healthz` 200, `/api/v1/version` shows new commit, observe error rate + latency 15 minutes (§74). Abort conditions per §73 — migration error, health failure, security regression, tenant-isolation failure, publishing uncertainty.

## Rollback

Application: pin previous immutable commit/artifact, restart. Data: follow `db/migrations/ROLLBACK.md` — no automatic claims; restore-from-backup is the post-data path.

## What release is NOT

Feature count, green CI alone, or conversion numbers without financial integrity. The decision lives in exactly one file and it requires zero unresolved evidence-backed blockers.
