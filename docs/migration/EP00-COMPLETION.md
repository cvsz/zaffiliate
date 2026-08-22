# EP-00 Migration Ledger — Evidence Checkpoint

Updated: 2026-08-22

## Verified source snapshots

All seven requested legacy repositories now have explicit immutable source snapshot SHAs in `SOURCE-SNAPSHOT-LEDGER.json`.

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

### Complete

- immutable HEAD/tree pins for all seven sources;
- repository-level source classification;
- generated-artifact exclusion rule established;
- secret-material quarantine rule established;
- canonical destination strategy established;
- deletion remains fail-closed.

### Still required before EP-00 may be marked DONE

- enumerate every blob from large/truncated trees into a machine-readable row-level ledger;
- classify every row as PORT / REWRITE / REFERENCE / DROP-GENERATED / DROP-UNRELATED / QUARANTINE-SECRET;
- record destination or explicit drop rationale for every blob;
- inventory all refs/tags/releases/issues/PRs required for historical preservation;
- create `git clone --mirror` backups and `git bundle --all` artifacts outside GitHub;
- SHA-256 the backup artifacts;
- execute a clean restore drill and compare refs;
- attach the resulting evidence manifest.

The connected GitHub API can inspect and mutate repository contents but cannot create local Git mirror/bundle artifacts or perform a trusted GPG signing operation. Therefore those evidence gates must be produced in a trusted local Git environment and committed back to this repository.

## Destructive-action verdict

**NO-GO. Legacy deletion remains forbidden.**

This is not a scheduling preference: the requested rollback guarantee cannot exist until mirror/bundle/restore evidence and 100% row-level classification are complete.
