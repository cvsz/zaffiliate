# Autopilot desktop review — implementation TODOs

Status: IN PROGRESS — review UI only; no production publishing is enabled. Review in existing React control plane at `/autopilot-review`. Reviewer notes remain in browser memory until exported to JSON; this is not a durable approval system.

## P0 before any production release

- [ ] Triage GitHub code-scanning alert #2 using authenticated alert detail (rule, location, dataflow, severity); remediate root cause, add regression test and confirm a fresh CodeQL scan. Do not infer alert type from its URL.
- [ ] Confirm tenant selection in `apps/web/src/App.jsx` is authorized server-side. Current UI displays hard-coded example tenant options; never treat a UI selection or `x-tenant-id` alone as authorization.
- [ ] Inspect approval snapshot binding across media hash, caption/metadata, target account, privacy/disclosure, actor, expiry and revocation.
- [ ] Demonstrate duplicate queue delivery, process crash, timeout-after-upload and remote reconciliation without duplicate external posts.
- [ ] Confirm backup with isolated restore, RPO/RTO, release rollback and monitored recovery.
- [ ] Replace any non-failing secret scan fallback with an enforced scanner and produce genuine SAST evidence; inspect CI workflow before claiming coverage.

## P1 user-visible end-to-end capabilities

- [ ] Tauri 2 Windows 11 shell around existing React/Vite web app; define secure session, IPC allowlist, updater, code signing, installer, upgrade/uninstall and Windows CI.
- [ ] Extend existing Shopee Thailand import and affiliate lifecycle to campaign-linked product snapshots and authorized account entitlements.
- [ ] Replace `packages/ai-content/src/video-factory.js` placeholder output with a real bounded FFmpeg worker; validate output and licensed media provenance, caption/subtitle timing, cancellation, retention and quotas.
- [ ] Add operator preview, immutable approval snapshot, timezone-aware publishing calendar, pause/resume and status reconciliation in the existing workflow.
- [ ] TikTok Content Posting API: creator info, commercial disclosures, consent, app audit and scope validation.
- [ ] Meta Page Reels: documented Page permissions, resumable upload and processing reconciliation.
- [ ] YouTube Shorts: OAuth, videos.insert resumable upload, quota/audit, metadata and privacy.
- [ ] Shopee Video and Shopee Live: verify separate regional official partner API rights. Until then export/manual handoff only.
- [ ] Build staging E2E with sandbox/authorized accounts, real Windows installer and verified publishing results for each enabled channel.

## P2 commercial and SaaS maturity

- [ ] Platform metric ingestion with provenance, timestamp and permissions; distinguish estimated, confirmed, reversed and paid commissions.
- [ ] Cross-platform campaign analytics and cost ceilings without inventing unavailable attribution.
- [ ] Accessibility, localization (Thai/English), offline read-only desktop experience and actionable error recovery.
- [ ] Multi-tenant quota/rate limits, signed auto-updates, support bundles with redaction and operator runbooks.

## Review acceptance

The new page is **read-only planning UI**, not a live feature-health endpoint. It must load from the existing navigation, filter by state, accept local reviewer notes, export JSON and never mutate provider accounts. Review every item against current code and update statuses only with evidence. Run `npm run check`, `npm test`, `npm run build:web`, security checks and relevant Windows CI before merging. Document exact SHA, failures and any skipped checks.
