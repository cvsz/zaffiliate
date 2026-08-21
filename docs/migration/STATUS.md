# Migration Status and Blocked Actions

Updated: 2026-08-21

## Completed in canonical repository

- `cvsz/zaffiliate` exists and is writable.
- Baseline audit performed against all seven legacy repository trees.
- Source snapshots are pinned in `docs/migration/AUDIT.md`.
- Deduplication matrix and missing-feature matrix are documented.
- Source-to-target migration map is documented.
- Production architecture, security and operations contracts are documented.
- Evidence-gated `ROADMAP.md` and `EXEC-PLANNING.md` are present.
- Critical legacy findings are recorded, including tracked secret-like values in `ztsaff`, missing `src.utils` dependency in `tiktok-shop-bot`, generated VitePress cache in `tiktok-shop-sdk`, overlapping TS/PHP SDK surfaces and excessive unrelated platform baggage in `ztsaff`.
- Legacy repositories have NOT been deleted.

## Not yet satisfied — deletion remains forbidden

The following are mandatory hard gates, not optional cleanup:

1. Machine-readable 100% blob migration ledger for every pinned legacy snapshot.
2. Mirror backups for all seven repos.
3. Verified `git bundle` backups for all refs.
4. SHA-256 manifest for backups and source refs.
5. Successful restore drill from those backups.
6. Rotation/revocation and historical secret scan for `ztsaff` exposed secret-like values.
7. Implemented canonical runtime code and data migrations.
8. Contract/parity tests, security gates, CI, load/soak and production-readiness evidence.
9. Reversible production cutover and reconciliation.
10. Archive observation period and explicit final deletion approval.

Until all ten pass, deleting a legacy repository would violate the migration/rollback contract.

## Connector capability blockers

### GPG-signed commit

The connected GitHub API mutation surface can create/update files and commits but does not expose a GPG commit-signature input or access to the maintainer's local private signing key. Commits created by this migration-documentation session are therefore API commits, not the requested maintainer GPG-signed commits.

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

### Repository deletion

The available connector exposes file deletion but no repository-delete action. Permanent legacy repository deletion therefore cannot be executed from this connector. More importantly, the completeness/backup/restore/security/cutover gates above are not yet satisfied, so deletion is intentionally blocked regardless of tooling.

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

**PRODUCTION IMPLEMENTATION/CUTOVER: NOT COMPLETE.**

**GPG ATTESTATION: BLOCKED IN CONNECTOR; requires trusted local Git/GPG environment.**

**LEGACY REPOSITORY DELETION: BLOCKED BY BOTH UNSATISFIED SAFETY GATES AND MISSING CONNECTOR CAPABILITY.**
