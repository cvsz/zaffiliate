# Closure Execution Plan

Updated: 2026-08-22

## Step 1: EP-01 Credential Rotation

Command: Follow `docs/closure/ep01-credential-rotation.md`

Providers: LINE, TikTok Shop, Generic (JWT/DATABASE_URL/ADMIN_BOOTSTRAP_KEY), MinIO/Gitea

Expected output: SHA-256 evidence files for each rotated credential, no legacy material in current trees or history.

Verification: `npm run check` (secret-scan CI job green), `node --test test/security-observability.test.js` pass.

Rollback: restore previous credential from backup, re-run verification.

## Step 2: EP-11 Production Harness Execution

Command: Follow `docs/closure/ep11-production-execution.md`

Gates: RLS negative tests, adapter contract tests, load test, soak test (1h min), fault injection, backup/restore drill, E2E smoke.

Expected output: evidence files in `dist/` and `backups/`, all thresholds pass.

Verification: p99 <= 500ms, errorRate <= 1%, successRate >= 99.9%, memory growth <= 20%, recovery rate 100%, backup SHA-256 matches restore.

Rollback: per-gate rollback commands in execution plan.

## Step 3: EP-12 Cutover Simulation

Command: `node scripts/cutover.mjs --phase=shadow`

Expected output: `dist/cutover-evidence.json` with `checks.dualWriteEnabled: true`, `checks.countsMatch: true`.

Verification: dual-write counts match within tolerance, no legacy mutation dependency detected.

Rollback: `node scripts/cutover.mjs --phase=rollback`

## Step 4: EP-12 Traffic Enable

Command: `node scripts/cutover.mjs --phase=enable`

Expected output: `dist/cutover-evidence.json` with `checks.routingFlipped: true`, `checks.legacyMutationsZero: true`.

Verification: `node scripts/post-cutover-slo-watch.mjs` all SLOs met, zero legacy mutations observed.

Rollback: `node scripts/cutover.mjs --phase=rollback`

## Step 5: EP-12B Release Candidate

Command: `node scripts/release-candidate.mjs --version=<version>`

Expected output: `dist/rc-evidence.json` with `checksPassed: true`.

Verification: npm run check green, npm test green, release manifest SHA-256 matches, SBOM generated.

Rollback: revert to previous release tag.

## Step 6: EP-12B Post-Release Smoke

Command: `node scripts/post-release-smoke.mjs --target=<production-url>`

Expected output: `dist/post-release-smoke-evidence.json` with `passed: true`.

Verification: /healthz 200, /readyz 200/503, /metrics 200 with expected metrics.

Rollback: revert to previous release tag.

## Step 7: EP-13 Legacy Retirement

Command: Follow `docs/closure/ep12-13-cutover-retirement.md` Phase 5

Steps: archive, restore drill, observation window (7 days), zero-dependency verification, owner approval, deletion, post-deletion validation.

Expected output: archived bundles, restore drill evidence, deletion confirmation.

Verification: no runtime/build/deployment dependency on legacy repos, canonical production stable.

Rollback: irreversible after deletion; archive must be retained for rollback.

## Step 8: EP-11B GPG Attestation

Command: Follow `docs/closure/ep11b-gpg-attestation.md`

Steps: configure git signing, create signed commit, verify signature, push, create signed tag, verify tag.

Expected output: `git log --show-signature` shows "Good signature", GitHub shows verified badge.

Verification: `git log -1 --show-signature`, GitHub commit verification page.

Rollback: re-attest with corrected key if needed.

## Evidence index

| Step | EP | Evidence file | Required for next step |
|------|----|---------------|------------------------|
| 1 | EP-01 | ep01-rotation-*.json | Yes |
| 2 | EP-11 | ep11-harness-*.json | Yes |
| 3 | EP-12 | ep12-cutover-shadow-*.json | Yes |
| 4 | EP-12 | ep12-cutover-enable-*.json | Yes |
| 5 | EP-12B | ep12b-rc-*.json | Yes |
| 6 | EP-12B | ep12b-smoke-*.json | Yes |
| 7 | EP-13 | ep13-retirement-*.json | Yes |
| 8 | EP-11B | ep11b-gpg-*.json | Final attestation |

## Sign-off

```
EP-01: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
EP-11: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
EP-12: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
EP-12B: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
EP-13: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
EP-11B: PASS | FAIL | BLOCKED — Verifier: ___ — Date: ___
```
