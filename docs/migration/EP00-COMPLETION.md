# EP-00 Migration Ledger — Evidence Checkpoint

Updated: 2026-08-22

## Verified source snapshots

All seven requested legacy repositories have explicit immutable source snapshot SHAs in `SOURCE-SNAPSHOT-LEDGER.json`, re-verified against live `HEAD` during evidence generation.

- `cvsz/zaffhub` @ `f4d50e4fe6cbfc97e601e6d266c1e0bc1e9c0176`
- `cvsz/ztsaff` @ `f4e0e25f255dff6dcfb6e2ccc475d29a1dedc97b`
- `cvsz/tiktok-shop-bot` @ `0e6128856c867172021e12d3fb570610443dcb7d`
- `cvsz/tiktok-shop-sdk` @ `0c53da6cbba91728401f79cda7156cc56a2cc7dd`
- `cvsz/tiktokshop-php` @ `dbbec213d9d118c443576d613571993090a843a5` (default branch is `master`)
- `cvsz/zlttbots` @ `139bde44dfa3bb3fd420a091988dafece8c70d0e`
- `cvsz/zttlbots` @ `18b5f572d5fe5926ab3286ee98b12bd3f7669474`

## Classification decisions established

1. `zaffhub` is specification/roadmap provenance, not a runtime donor to copy wholesale.
2. `ztsaff` is mixed-purpose and must be selectively extracted. Runtime `.env`/secret-like material is quarantined and never imported.
3. `tiktok-shop-bot` is an outreach semantic donor. Its small tree is explicitly known and its missing `src.utils` dependency must be repaired rather than copied.
4. `tiktok-shop-sdk` is the primary TypeScript TikTok contract donor. Generated `.vitepress/cache/**` content is DROP/REGENERATE, not canonical source.
5. `tiktokshop-php` is the secondary parity oracle, especially AffiliateCreator/AffiliatePartner/AffiliateSeller, analytics, auth, webhook, finance, fulfillment, orders, products, promotions and returns.
6. `zlttbots` is the principal enterprise-runtime donor for CI/security/observability/resiliency and its unified affiliate-marketing work.
7. `zttlbots` is a selective donor for billing ledger/meter/guard, LLM routing/safety/tooling and core security/config patterns.

## EP-00 status

### Complete (evidence generated 2026-08-22)

- immutable HEAD/tree pins for all seven sources; pins re-verified against mirrors;
- repository-level source classification;
- **machine-readable row-level ledger covering all 1,639 blobs across the seven pinned snapshots** (`docs/migration/evidence/blob-ledger.json`);
- **100% of rows classified** as MIGRATE / PORT / REFERENCE / DROP-GENERATED / DROP-DUPLICATE / DROP-UNRELATED / QUARANTINE-SECRET / ARCHIVE-EVIDENCE with destination or explicit drop rationale per row;
- blob SHA and size recorded for every row; duplicate-content detection performed (266 duplicate rows annotated);
- generated-artifact exclusion rule applied (lockfiles, vitepress cache, sitemaps, generated i18n types);
- secret-material quarantine rule applied and enforced by content scan;
- **branch/tag/release/issue/PR inventory exported** for every repo (`sources[].refs`, `sources[].github_inventory`; zlttbots has exactly 100 PRs — fully captured);
- **`git clone --mirror` backups created** locally at `/home/cvsz/legacy-migration-backup`;
- **`git bundle --all` artifacts created and `git bundle verify` passed** for all seven repos with SHA-256 manifests (`docs/migration/evidence/legacy-manifest.json`);
- **restore drill executed: clean clones from each bundle produced byte-identical ref sets** (`restore_drill_refs_identical=true` for all seven).

### Still required before destructive action

- rotate/revoke every credential listed in `docs/migration/evidence/rotation-requirements.json` and anything reused from it (EP-01 gate; key names only are exported, values never leave the legacy objects);
- implement the canonical runtime and pass parity/security/cutover gates.

The evidence generator lives at `tools/migration/build-ep00-evidence.mjs` and regenerates ledger, manifest and drill results deterministically from the local mirrors.

## Destructive-action verdict

**NO-GO. Legacy deletion remains forbidden.**

Backup/ledger gates now pass, but rollback guarantees still require completed credential rotation (EP-01) and implemented canonical runtime parity before any destructive action.
