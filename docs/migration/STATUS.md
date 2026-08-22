# Migration Status and Blocked Actions

Updated: 2026-08-22

## Completed in canonical repository

- `cvsz/zaffiliate` exists and is writable.
- Baseline audit performed against all seven legacy repository trees.
- Immutable source snapshot SHAs for all seven repositories are pinned in `docs/migration/SOURCE-SNAPSHOT-LEDGER.json`.
- Deduplication matrix and missing-feature matrix are documented.
- Source-to-target migration map is documented.
- Production architecture, security and operations contracts are documented.
- Evidence-gated `ROADMAP.md` and `EXEC-PLANNING.md` are present.
- Critical legacy findings are recorded, including tracked secret-like values in `ztsaff`, missing `src.utils` dependency in `tiktok-shop-bot`, generated VitePress cache in `tiktok-shop-sdk`, overlapping TS/PHP SDK surfaces and excessive unrelated platform baggage in `ztsaff`.
- Canonical runnable baseline exists: root Node workspace contract, secure `.gitignore`, sanitized `.env.example`, API `/healthz` and fail-closed `/readyz`, tenant/affiliate domain contracts, and deterministic Node tests.
- GitHub Actions CI workflow now validates syntax/tests and rejects tracked runtime secret material or high-signal private-key/API-key patterns.
- Legacy repositories have NOT been deleted.

## Canonical runtime baseline evidence

Current bootstrap files include:

- `package.json`
- `.gitignore`
- `.env.example`
- `apps/api/src/server.js`
- `packages/contracts/src/index.js`
- `test/contracts.test.js`
- `.github/workflows/ci.yml`

The API intentionally reports readiness failure until required external dependencies (`DATABASE_URL`, `REDIS_URL`) are configured. This is fail-closed behavior, not a production-ready claim.

At the time this status was updated, the latest CI commit did not yet expose a completed combined-status result through the connector, so CI is **configured but not yet evidenced green**.

## Not yet satisfied — deletion remains forbidden

The following are mandatory hard gates, not optional cleanup:

1. Machine-readable 100% blob migration ledger for every pinned legacy snapshot.
2. Mirror backups for all seven repos.
3. Verified `git bundle` backups for all refs.
4. SHA-256 manifest for backups and source refs.
5. Successful restore drill from those backups.
6. Rotation/revocation and historical secret scan for `ztsaff` exposed secret-like values.
7. Full canonical runtime/data migrations and required marketplace/channel adapters.
8. Green contract/parity/security/CI/load/soak and production-readiness evidence.
9. Reversible production cutover and reconciliation.
10. Archive observation period and explicit final deletion approval.

Until all ten pass, deleting a legacy repository would violate the migration/rollback contract.

## Connector capability blockers

### GPG-signed commit

The connected GitHub API mutation surface can create/update files and commits but does not expose a GPG commit-signature input or access to the maintainer's local private signing key. Commits created by this migration session are therefore API commits, not maintainer GPG-signed commits.

Required local attestation after pulling these changes:

```bash
git clone https://github.com/cvsz/zaffiliate.git
cd zaffiliate
git config commit.gpgsign true
git config user.signingkey <YOUR_GPG_KEY_ID>
git commit --allow-empty -S -m "chore: GPG attest affiliate migration baseline"
git log -1 --show-signature
git push origin main
```

Use the maintainer's existing trusted GPG key. Never export or upload the private key to automation.

### GPG/signed push certificate

The connector has no signed-push primitive. A signed Git commit/tag is the portable provenance gate. If the remote rejects `git push --signed`, push the already GPG-signed commit normally and verify the commit signature on GitHub/local Git.

### Mirror/bundle/restore evidence

The connector cannot execute local `git clone --mirror`, `git bundle`, SHA-256 filesystem manifests, or an isolated restore drill. Those artifacts must be generated in a trusted Git environment and their evidence committed back to `zaffiliate`.

### Repository deletion

The available connector exposes file deletion but no repository-delete action. Permanent legacy repository deletion therefore cannot be executed from this connector. More importantly, completeness/backup/restore/security/parity/cutover gates are not yet satisfied, so deletion is intentionally blocked regardless of tooling.

## Required final destructive procedure

Only after all gates pass:

1. archive each legacy repo first;
2. verify canonical production stability and backup restoration again;
3. record final legacy HEAD/tag/ref manifests;
4. obtain explicit owner approval for permanent deletion;
5. delete from a trusted GitHub admin environment;
6. immediately validate canonical repo, backups and documentation links after deletion.

## Current verdict

**AUDIT/MIGRATION PACKAGE BASELINE: COMPLETE AND PUSHED VIA GITHUB API.**

**CANONICAL RUNTIME BOOTSTRAP: IMPLEMENTED; CI GREEN EVIDENCE PENDING.**

**EP-00: PARTIAL — source pins complete, 100% row-level blob ledger + backup/restore evidence pending.**

**EP-01: PARTIAL — canonical secret boundary/CI guard implemented; legacy credential rotation/history scan pending.**

**EP-02: STARTED — runnable API/contracts/tests/CI baseline exists; production dependencies/adapters/data layer pending.**

**PRODUCTION IMPLEMENTATION/CUTOVER: NOT COMPLETE.**

**GPG ATTESTATION: BLOCKED IN CONNECTOR; requires trusted local Git/GPG environment.**

**LEGACY REPOSITORY DELETION: BLOCKED BY BOTH UNSATISFIED SAFETY GATES AND MISSING CONNECTOR CAPABILITY.**
