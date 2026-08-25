# EP-12/12B/13 Cutover, Release and Legacy Retirement Runbook

Scope: final production cutover from legacy systems to the canonical `zaffiliate` repository, the combined EP-12/EP-12B/EP-13 release, and permanent retirement of all seven legacy repositories.

Legacy repositories in scope (all pinned in `docs/migration/SOURCE-SNAPSHOT-LEDGER.json`, backed up in `/home/cvsz/legacy-migration-backup/`, manifests in `docs/migration/evidence/legacy-manifest.json`):

1. `cvsz/zaffhub`
2. `cvsz/ztsaff`
3. `cvsz/tiktok-shop-bot`
4. `cvsz/tiktok-shop-sdk`
5. `cvsz/tiktokshop-php`
6. `cvsz/zlttbots`
7. `cvsz/zttlbots`

Canonical repository: `cvsz/zaffiliate`.

This runbook is executed end to end only after every gate below is green. No phase may begin until the previous phase is verified and signed off.

## Authority and approval model

- Cutover execution is performed by the on-call SRE plus the release engineer.
- Each phase requires an explicit written sign-off in the evidence table below.
- Deletion (Phase 5) requires an additional explicit owner approval, recorded immediately before deletion, in a trusted GitHub admin environment.
- All destructive operations are recorded with a UTC timestamp, command, expected output, actual output, and verifier.

## Stop-the-line conditions (apply to every phase)

- Any gate checked `Pending` or `Failed`.
- Data reconciliation reports `balanced: false`.
- Shadow-phase dual-write count mismatch.
- Enable-phase legacy dependency detected (`legacyMutationsZero === false`).
- SLO watch reports `alertTriggered: true`.
- Post-release smoke reports `passed: false`.
- Missing owner approval for a required step.
- Restore drill from archived artifacts fails.
- Any zero-tolerance invariant from `docs/SLO.md` is violated (cross-tenant exposure, auth/approval bypass, active secret exposure, duplicate/lost financial mutation, irrecoverable backup failure, silent billing corruption).

---

## Pre-flight checklist (all must be green)

Before Phase 1 may begin, every item below must be green and evidenced.

| Gate | Evidence reference | Status |
|------|-------------------|--------|
| All EP-11 gates green (tests, harnesses, scans) | `test/e2e.test.js` (7 surfaces), `test/ep11-harnesses.test.js`, CI SAST/secret-scan/dependency-audit jobs, `docs/security/threat-model.md` STRIDE analysis | |
| EP-01 credential rotation evidence complete | `docs/migration/credential-rotation-evidence.md`, `docs/migration/evidence/rotation-requirements.json`; every legacy secret in `ztsaff`, `zlttbots`, `zttlbots` rotated; active canonical secret store verified against `docs/migration/evidence/blob-ledger.json` (no legacy reuse) | |
| Backup/restore drill successful | `docs/migration/evidence/legacy-manifest.json` (`restore_drill_refs_identical: true` for all 7 repos), `node scripts/backup-restore-drill.mjs` output | |
| Canonical production stable for observation window | 7-day continuous observation of `dist/post-release-smoke-evidence.json`, SLO report from `node scripts/post-cutover-slo-watch.mjs`, error rate < 0.5% over rolling 5m | |
| Legacy repos intact and accessible | `head_matches_pin: true` for all 7 repos in `legacy-manifest.json`, mirrors present at `/home/cvsz/legacy-migration-backup/*` | |
| Owner approval recorded for cutover | Sign-off entry in Phase 5 evidence table (cannot be back-dated) | |

---

## Phase 1: Pre-cutover preparation

### 1.1 Freeze legacy mutations

Disable write access to legacy systems to establish a fixed migration source.

Command:
```bash
node scripts/migrate-data.mjs --dry-run --source=docs/migration/SOURCE-SNAPSHOT-LEDGER.json
```

Expected:
- stdout JSON with `"dryRun": true`, `"balanced": true`, `transformed` count equals `targetRecords`, `sha256` populated.
- Process exits 0.
- No files written under `dist/`.

Actions:
- Set all 7 legacy repositories to read-only (disable web UI writes, API tokens, CI write dispatch).
- Lock the source ledger at `docs/migration/SOURCE-SNAPSHOT-LEDGER.json`.

### 1.2 Final delta sync

Run the canonical data migration against the latest source ledger.

Command:
```bash
node scripts/migrate-data.mjs --source=docs/migration/SOURCE-SNAPSHOT-LEDGER.json
```

Expected:
- Outputs `dist/migration-target-manifest.json` and `dist/migration-target-manifest.sha256`.
- stdout JSON with `"balanced": true` and a stable `sha256` matching the prior dry-run.

### 1.3 Reconciliation

Run reconciliation for every dataset. Valid datasets: `commissions`, `billing`, `webhooks`.

Command:
```bash
node scripts/reconcile.mjs --dataset=commissions
node scripts/reconcile.mjs --dataset=billing
node scripts/reconcile.mjs --dataset=webhooks
```

Expected per dataset:
- Writes `dist/reconcile-<dataset>-evidence.json`.
- stdout JSON with `"balanced": true` and `"deltaMinorUnits": 0`.
- Process exits 0.

Stop-the-line: any dataset reports `balanced: false` or non-zero delta.

### 1.4 Record baseline metrics

Record pre-cutover baseline for SLOs, queue depths, and error rates.

Command:
```bash
node scripts/post-cutover-slo-watch.mjs
```

Expected:
- Returns `alertTriggered: false` with SLO evaluations for `http_availability` and `http_latency`.

Also record:
- Queue depth (Redis) snapshot.
- Error rate (5xx) over rolling 5 minutes.
- SLO targets as declared in `docs/SLO.md`.

### Phase 1 evidence

| Step | Command | Expected output | Actual output | Status | Timestamp | Verifier |
|------|---------|-----------------|---------------|--------|-----------|----------|
| Freeze legacy | `--` (read-only toggle) | All 7 repos read-only, writes rejected | | | | |
| Delta sync | `node scripts/migrate-data.mjs --source=...` | `"balanced": true`, stable `sha256` | | | | |
| Reconcile commissions | `node scripts/reconcile.mjs --dataset=commissions` | `"balanced": true`, `"deltaMinorUnits": 0` | | | | |
| Reconcile billing | `node scripts/reconcile.mjs --dataset=billing` | `"balanced": true`, `"deltaMinorUnits": 0` | | | | |
| Reconcile webhooks | `node scripts/reconcile.mjs --dataset=webhooks` | `"balanced": true`, `"deltaMinorUnits": 0` | | | | |
| Baseline metrics | `node scripts/post-cutover-slo-watch.mjs` | `"alertTriggered": false` | | | | |

### Phase 1 sign-off

```
Phase 1 Sign-off
================
Checklist complete: [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```

---

## Phase 2: Shadow cutover

Dual-write simulation: canonical writes proceed alongside legacy, counts are compared, no production traffic is routed yet.

Command:
```bash
node scripts/cutover.mjs --phase=shadow
```

Expected:
- Writes `dist/cutover-evidence.json`.
- stdout JSON with `phase: "shadow"`, `checks.dualWriteEnabled: true`, `checks.countsMatch: true`, `rollbackAvailable: true`, `stopped: false`.

### 2.1 Verify dual-write counts match

- Compare canonical write count versus legacy write count for the shadow window.
- Confirm `countsMatch: true`.

### 2.2 Monitor for 24-48 hours

- Run `node scripts/post-cutover-slo-watch.mjs` continuously.
- Watch for shadow-phase count drift, duplicate external mutations, and error budget depletion.
- No production traffic is routed through the canonical path yet; this phase only validates write parity.

Stop-the-line: `countsMatch` is not true, or any count drift exceeds tolerance, or `alertTriggered: true`.

### Phase 2 evidence

| Step | Command | Expected output | Actual output | Status | Timestamp | Verifier |
|------|---------|-----------------|---------------|--------|-----------|----------|
| Shadow phase | `node scripts/cutover.mjs --phase=shadow` | `phase:"shadow"`, `"dualWriteEnabled": true`, `"countsMatch": true`, `"rollbackAvailable": true`, `"stopped": false` | | | | |
| SLO watch | `node scripts/post-cutover-slo-watch.mjs` | `"alertTriggered": false` | | | | |
| Dual-write count comparison | manual/observability | canonical count == legacy count | | | | |

### Phase 2 sign-off

```
Phase 2 Sign-off
================
Shadow cutover verified: [ ] Yes  [ ] No
Counts match: [ ] Yes  [ ] No
SLO watch clean (24-48h): [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```

---

## Phase 3: Traffic enable

Flip routing to the canonical path. This is the first point where production traffic flows through `zaffiliate`.

Command:
```bash
node scripts/cutover.mjs --phase=enable
```

Expected:
- Writes `dist/cutover-evidence.json`.
- stdout JSON with `phase: "enable"`, `checks.routingFlipped: true`, `checks.legacyMutationsZero: true`, `rollbackAvailable: true`, `stopped: false`.

### 3.1 Verify zero legacy dependency

- Confirm `legacyMutationsZero: true`.
- Confirm no runtime/build time import of the 7 legacy repositories from the canonical repo.

### 3.2 Monitor SLOs

Command:
```bash
node scripts/post-cutover-slo-watch.mjs
```

Expected:
- `alertTriggered: false` for the declared observation window.
- Targets from `docs/SLO.md` met.

### 3.3 Rollback path (conditional)

If issues are detected, immediately run:

Command:
```bash
node scripts/cutover.mjs --phase=rollback
```

Expected:
- stdout JSON with `phase: "rollback"`, `checks.routingReverted: true`, `checks.dataIntact: true`.

Stop-the-line: `routingFlipped` is not true, `legacyMutationsZero` is not true, or `alertTriggered: true` persists after rollback.

### Phase 3 evidence

| Step | Command | Expected output | Actual output | Status | Timestamp | Verifier |
|------|---------|-----------------|---------------|--------|-----------|----------|
| Enable phase | `node scripts/cutover.mjs --phase=enable` | `phase:"enable"`, `"routingFlipped": true`, `"legacyMutationsZero": true`, `"rollbackAvailable": true`, `"stopped": false` | | | | |
| Zero legacy dep | dependency/import scan | no imports from legacy repos in canonical build/runtime | | | | |
| SLO watch | `node scripts/post-cutover-slo-watch.mjs` | `"alertTriggered": false` | | | | |
| Rollback (if invoked) | `node scripts/cutover.mjs --phase=rollback` | `phase:"rollback"`, `"routingReverted": true`, `"dataIntact": true` | | | | |

### Phase 3 sign-off

```
Phase 3 Sign-off
================
Traffic enabled on canonical: [ ] Yes  [ ] No
Zero legacy dependency: [ ] Yes  [ ] No
SLO watch clean: [ ] Yes  [ ] No
Rollback available: [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```

---

## Phase 4: Post-cutover validation

Independent validation that the canonical path is fully live and correct.

### 4.1 Webhook reconciliation

Command:
```bash
node scripts/reconcile.mjs --dataset=webhooks
```

Expected:
- Writes `dist/reconcile-webhooks-evidence.json`.
- stdout JSON with `"balanced": true`, `"deltaMinorUnits": 0`.

### 4.2 Release smoke

Command:
```bash
node scripts/post-release-smoke.mjs
```

Expected:
- Starts a local server from `apps/api/src/server.js` (`buildServer`) and asserts:
  - `/healthz` returns 200 and body `{ ok: true, service: 'zaffiliate-api' }` (per `test/e2e.test.js`).
  - `/readyz` returns 200 or 503.
  - `/metrics` returns 200 and body contains `zaffiliate_http_requests_total`.
- Returns evidence with `passed: true`.

### 4.3 E2E surface coverage

Run the E2E smoke harness covering all 7 surfaces:

Command:
```bash
node --test test/e2e.test.js
```

Expected: all 7 surfaces pass (API health, readyz, metrics, web root, web navigation, web audit, cross-origin block).

### 4.4 Record final evidence

- Capture final SLO report.
- Capture final metrics snapshot.
- Capture reconciliation artifacts.

Stop-the-line: webhook reconciliation not balanced, smoke `passed: false`, or any E2E surface failing.

### Phase 4 evidence

| Step | Command | Expected output | Actual output | Status | Timestamp | Verifier |
|------|---------|-----------------|---------------|--------|-----------|----------|
| Webhook reconcile | `node scripts/reconcile.mjs --dataset=webhooks` | `"balanced": true`, `"deltaMinorUnits": 0` | | | | |
| Release smoke | `node scripts/post-release-smoke.mjs` | `passed: true`, healthz/readyz/metrics checks green | | | | |
| E2E surfaces | `node --test test/e2e.test.js` | 7/7 surfaces pass | | | | |
| Final SLO report | `node scripts/post-cutover-slo-watch.mjs` | `"alertTriggered": false` | | | | |

### Phase 4 sign-off

```
Phase 4 Sign-off
================
Webhook reconciliation green: [ ] Yes  [ ] No
Post-release smoke green: [ ] Yes  [ ] No
E2E surfaces green (7/7): [ ] Yes  [ ] No
Final evidence recorded: [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```

---

## Phase 5: Legacy retirement

Only begins after Phase 4 is signed off. This is the irreversible step.

### 5.1 Archive all 7 legacy repositories

For each repository in `docs/migration/evidence/legacy-manifest.json`:

1. Freeze all write access (commits, tags, issues, PRs, wikis).
2. Create a fresh `git clone --mirror` into `/home/cvsz/legacy-migration-backup/mirrors/`.
3. Regenerate `git bundle` artifacts for every ref into `/home/cvsz/legacy-migration-backup/bundles/`.
4. Compute SHA-256 over each mirror directory and each bundle file.
5. Update `docs/migration/evidence/legacy-manifest.json` with the new `bundle_sha256` and `bundle_verified: true`, and a freshly recorded `head_matches_pin` check against the pinned `snapshot_sha`.

Repositories:

| Repository | snapshot_sha (pinned) | bundle path |
|------------|------------------------|-------------|
| `cvsz/zaffhub` | `f4d50e4fe6cbfc97e601e6d266c1e0bc1e9c0176` | `/home/cvsz/legacy-migration-backup/bundles/zaffhub.bundle` |
| `cvsz/ztsaff` | `f4e0e25f255dff6dcfb6e2ccc475d29a1dedc97b` | `/home/cvsz/legacy-migration-backup/bundles/ztsaff.bundle` |
| `cvsz/tiktok-shop-bot` | `0e6128856c867172021e12d3fb570610443dcb7d` | `/home/cvsz/legacy-migration-backup/bundles/tiktok-shop-bot.bundle` |
| `cvsz/tiktok-shop-sdk` | `0c53da6cbba91728401f79cda7156cc56a2cc7dd` | `/home/cvsz/legacy-migration-backup/bundles/tiktok-shop-sdk.bundle` |
| `cvsz/tiktokshop-php` | `dbbec213d9d118c443576d613571993090a843a5` | `/home/cvsz/legacy-migration-backup/bundles/tiktokshop-php.bundle` |
| `cvsz/zlttbots` | `139bde44dfa3bb3fd420a091988dafece8c70d0e` | `/home/cvsz/legacy-migration-backup/bundles/zlttbots.bundle` |
| `cvsz/zttlbots` | `18b5f572d5fe5926ab3286ee98b12bd3f7669474` | `/home/cvsz/legacy-migration-backup/bundles/zttlbots.bundle` |

### 5.2 Restore drill from archived artifacts

Run a full restore drill from the freshly generated archives, regenerating each repo from its bundle and verifying ref sets are byte-identical to the pinned snapshots.

Command:
```bash
node scripts/backup-restore-drill.mjs
```

Expected:
- All ref sets byte-identical to `restored_identical: true` (record in `legacy-manifest.json`).
- `bundle_verified: true`, `restore_drill_refs_identical: true` for all 7 repos.

Stop-the-line: any repo fails to restore byte-identically.

### 5.3 Observation window (7 days minimum)

- Run canonical production continuously for at least 7 days.
- Continuously monitor: zero runtime/build dependency on any legacy repo, SLOs green (`node scripts/post-cutover-slo-watch.mjs` with `alertTriggered: false`), webhook reconciliation balanced, and no new legacy write attempts.
- Capture daily snapshots of these metrics.

### 5.4 Verify zero dependency on legacy

- Dependency/import scan: canonical repo (`apps/*`, `packages/*`, `scripts/*`, `test/*`) must not import or reference the 7 legacy repositories at build, test, or runtime.
- CI against legacy repositories must show no consumers.
- Secret store must contain no active credential whose value matches or is trivially derived from legacy material (compare against `docs/migration/evidence/blob-ledger.json`).

### 5.5 Record explicit owner approval for deletion

Explicit, time-stamped owner approval must be recorded in this runbook's evidence table immediately before deletion. This approval is non-delegable and must come from the repository owner or an authorized delegate.

### 5.6 Permanent deletion (trusted GitHub admin environment)

Deletion must be performed from a trusted GitHub admin environment that has repository-delete scope and does not share credentials with CI.

For each repository, in order:

1. Confirm the latest archive/restore evidence is recorded and signed off.
2. Confirm owner approval is present and time-stamped.
3. Delete the repository via the GitHub admin API or GitHub UI.
4. Record the deletion event.

Stop-the-line: do not delete if any archive/restore drill fails, any dependency check is non-green, or owner approval is missing.

### 5.7 Immediate post-deletion validation

After deletion of each repository (and after all deletions complete):

- Re-run `node scripts/post-release-smoke.mjs` — `passed: true`.
- Re-run `node --test test/e2e.test.js` — 7/7 surfaces.
- Re-run `node scripts/reconcile.mjs --dataset=webhooks` — `balanced: true`.
- Confirm no build/test/runtime reference resolves to a now-deleted legacy repository.
- Confirm `docs/migration/evidence/legacy-manifest.json` is the authoritative record (archives remain available at `/home/cvsz/legacy-migration-backup/`).

### Phase 5 evidence

| Step | Command / Action | Expected output | Actual output | Status | Timestamp | Verifier |
|------|------------------|-----------------|---------------|--------|-----------|----------|
| Archive repo 1 | `git clone --mirror` + bundle + SHA-256 | `head_matches_pin: true`, `bundle_verified: true` | | | | |
| Archive repo 2 | ... | ... | | | | |
| Archive repo 3 | ... | ... | | | | |
| Archive repo 4 | ... | ... | | | | |
| Archive repo 5 | ... | ... | | | | |
| Archive repo 6 | ... | ... | | | | |
| Archive repo 7 | ... | ... | | | | |
| Restore drill | `node scripts/backup-restore-drill.mjs` | `restore_drill_refs_identical: true` for all 7 | | | | |
| Observation window | 7-day continuous monitoring | `alertTriggered: false`, no legacy deps | | | | |
| Zero legacy dependency | dependency/import + secret scan | no imports; no secret reuse | | | | |
| Owner approval | recorded in this table | timestamped, explicit owner approval | | | | |
| Permanent deletion | GitHub admin env, per repo | repo returns 404 | | | | |
| Post-deletion validation | `node scripts/post-release-smoke.mjs`; `node --test test/e2e.test.js`; `node scripts/reconcile.mjs --dataset=webhooks` | `passed: true`; 7/7 surfaces; `balanced: true` | | | | |

### Phase 5 sign-off

```
Phase 5 Sign-off
================
All archives verified: [ ] Yes  [ ] No
Restore drill byte-identical: [ ] Yes  [ ] No
Observation window (7d) clean: [ ] Yes  [ ] No
Zero legacy dependency confirmed: [ ] Yes  [ ] No
Secret reuse confirmed (none): [ ] Yes  [ ] No
Owner approval recorded: [ ] Yes  [ ] No
Permanent deletion complete: [ ] Yes  [ ] No
Post-deletion validation green: [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```

---

## Evidence template (per phase)

Each phase records evidence in the table immediately above it. The canonical evidence template is:

| Field | Definition |
|-------|-----------|
| Phase | Phase identifier (1, 2, 3, 4, 5) |
| Step | Specific step being verified |
| Command | Exact command executed (or action taken) |
| Expected output | Success condition for the command |
| Actual output | Observed output (filled during execution) |
| Status | Green / Amber / Red |
| Timestamp | UTC ISO-8601 |
| Verifier | Identity of the person who verified the step |

Evidence artifacts produced by commands are persisted under `dist/`:
- `dist/migration-target-manifest.json`, `dist/migration-target-manifest.sha256`
- `dist/reconcile-<dataset>-evidence.json` (for `commissions`, `billing`, `webhooks`)
- `dist/cutover-evidence.json`
- `dist/post-release-smoke-evidence.json`

These artifacts are committed alongside this runbook as part of the final release attestation (`test/release-attestation.test.js`).

---

## Rollback matrix

| From phase | Can roll back to | Command | Data integrity guarantee |
|------------|------------------|---------|--------------------------|
| Phase 3 (enable) | Phase 2 (shadow) | `node scripts/cutover.mjs --phase=rollback` | Routing flag reverted; canonical and legacy writes isolated; no further canonical traffic until re-evaluate. `dataIntact: true` asserted by cutover script. |
| Phase 3 (enable) | Phase 1 (pre-cutover) | `node scripts/cutover.mjs --phase=rollback` then re-run reconcile | Counts reset to pre-flight baseline. Reconciliation re-run for `commissions`, `billing`, `webhooks` to re-establish `balanced: true`. |
| Phase 2 (shadow) | Phase 1 (pre-cutover) | `node scripts/cutover.mjs --phase=rollback` | Shadow dual-write disabled; legacy remains source of truth; no canonical traffic routed. `routingReverted: true`, `dataIntact: true`. |
| Phase 4 (post-cutover validation) | Phase 3 (enable) | `node scripts/cutover.mjs --phase=rollback` | Traffic reverted to legacy; validation artifacts preserved for re-attempt. |
| Phase 5 (retirement) | Phase 4 (post-cutover) | Restore latest bundle: `git clone --mirror` from `/home/cvsz/legacy-migration-backup/` | Irreversible only for the deletion action; archived bundles remain byte-identical to pinned snapshots. Full legacy repo restored from bundle with `restore_drill_refs_identical: true`. |

Rollback rules:
- Phases 1 through 4 are fully reversible. No data is lost or mutated in a way that cannot be reconciled.
- Phase 5 (permanent deletion) is reversible only from archive: the 7 repositories are restored from the verified `git bundle` artifacts in `/home/cvsz/legacy-migration-backup/bundles/`. The source-of-truth for restoration is `docs/migration/evidence/legacy-manifest.json`.
- If any rollback integrity check reports `dataIntact: false`, halt immediately and engage the on-call incident. Do not attempt further automation.

---

## Final release and closure

1. Publish the canonical release manifest:
   ```bash
   node scripts/generate-release-manifest.mjs
   ```
   Expected: `dist/manifest.json` and `dist/release-manifest.sha256` produced, GPG-attested via `node scripts/gpg-attest.mjs`.
2. Publish SBOM and provenance for release artifacts:
   ```bash
   node scripts/generate-sbom.mjs
   ```
3. Run the release attestation test:
   ```bash
   node --test test/release-attestation.test.js
   ```
4. Update `ROADMAP.md` and `exec-planning.md` to mark EP-12, EP-12B, and EP-13 complete.
5. Close all open migration/rotation tickets in the tracker.

### Closure sign-off

```
Closure Sign-off
================
Full cutover complete: [ ] Yes  [ ] No
Final release attested: [ ] Yes  [ ] No
Legacy retirement complete: [ ] Yes  [ ] No
Owner approval for deletion: [ ] Yes  [ ] No
Documentation updated: [ ] Yes  [ ] No
Verifier:
Date:
Notes:
```
