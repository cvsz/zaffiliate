# ZEAZ Affiliate Autopilot — Windows delivery contract

Status: PLANNED (not production-ready). Owner: ZEAZDEV. Target: Windows 11, with always-on server deployment as a separate operational decision.

## Verified repository baseline

The existing canonical implementation is a Node.js 22+ ESM application with a React/Vite web control plane, PostgreSQL tenant RLS, Redis, durable outbox, existing provider capability and approval boundaries, and a CI validation suite. Preserve these foundations. **Do not introduce FastAPI, Celery, or a second database stack** merely to match an earlier greenfield proposal. Build the Windows client as a thin Tauri 2 shell around existing authenticated web/API contracts, after confirming Tauri build prerequisites and licensing. Keep all provider credentials server-side.

Existing docs: `AGENTS.md`, `ARCHITECTURE.md`, `EXEC-PLANNING.md`, `ROADMAP.md`. This plan supplements, not supersedes, those documents. Any slice must be recorded in the canonical `EXEC-PLANNING.md` before implementation.

## User journey

Product/offer import → affiliate link and commission snapshot → campaign → AI-assisted script and licensed assets → deterministic 9:16 render → creator preview and **content-version/account/platform-specific approval** → scheduled durable publication → official API status reconciliation → platform metrics and confirmed-vs-estimated commissions.

No production posting, live broadcast, external credential rotation, or legacy cutover is authorized by this document.

## Proposed additive layout (only create when needed)

- `apps/desktop/`: Tauri 2 shell, Windows installer, secure session handoff; reuse `apps/web/` React UI.
- `packages/ai-content/`: existing content pipeline, extend with licensed asset provenance, render worker and media checks.
- `packages/workflow/`: existing durable scheduling/outbox; extend immutable approval snapshots and publication reconciliation.
- `packages/adapters/`: extend capability manifests for TikTok, Shopee Video/Live, Meta Reels and YouTube Shorts. Unsupported operations remain disabled.
- `docs/operations/`: Windows install/upgrade/uninstall, server deployment, backup/restore and rollback.
- `test/`: deterministic contract, approval, scheduling and provider-mock tests; Windows CI where feasible.

## Platform capability gates

| Channel | Required verification | Fail-closed fallback |
|---|---|---|
| TikTok | Current Content Posting API, app audit, approved scope, creator-info/consent and commercial disclosure requirements | Approved draft/manual handoff |
| Shopee Video | Country/account-specific documented publishing API and actual partner entitlement | Manual export/handoff; no private endpoints |
| Shopee Live | Separately documented and entitled live-broadcast integration, operator control and safety procedures | Human-operated broadcast only |
| Facebook Reels | Meta Graph API Page publishing permission, valid Page token and processing-status reconciliation | Export/manual posting |
| YouTube Shorts | OAuth videos.insert, API project audit/quota, current vertical-video eligibility and disclosure | Private upload or export according to permission |

Affiliate-link APIs and video/live publishing rights are **different capabilities**. Verify official documentation and live account entitlements before enabling each adapter. Never automate browsers to bypass API restrictions.

## Bounded implementation slices

1. **AUTO-WIN-00 — Baseline and capability inventory (P0):** record immutable main SHA; inspect actual routes, adapters, CI, migration ledger, existing approval and outbox semantics. Map reused components, platform permissions and gaps. No migrations or dependency changes. Exit: evidence-backed gap matrix and updated canonical planning entry.
2. **AUTO-WIN-01 — Desktop shell (P1):** Tauri 2 Windows app reusing the current React/Vite control plane; secure backend session; no embedded OAuth client secrets. Exit: clean Windows install/upgrade/uninstall and signed-release plan; CI artifacts and smoke-test evidence.
3. **AUTO-WIN-02 — Media pipeline (P1):** reusable AI prompt/version, commercial asset licensing, FFmpeg render worker, 9:16 preview, subtitles and cost ceilings. Exit: reproducible fixture render, cancellation and corrupt-media tests.
4. **AUTO-WIN-03 — Approval and schedule (P0):** immutable approved content hash + destination + metadata/privacy/disclosure snapshot; timezone-aware scheduling, expiry/revocation, kill switches, transactional outbox and ambiguous remote status quarantine. Exit: crash/restart/race tests show no duplicate external mutation.
5. **AUTO-WIN-04 — Provider integrations (P1, per-provider PR):** official OAuth/API adapter, capability probe, upload/status reconciliation, quota/backoff, provider mocks, sandbox or authorized-account evidence. Unapproved adapters stay disabled.
6. **AUTO-WIN-05 — Attribution and analytics (P2):** ingest authorized metrics and reports with freshness/provenance; separate estimated, confirmed, reversed and paid commissions; tenant isolation and reconciliation tests.
7. **AUTO-WIN-06 — Release operations (P0):** CI Windows build, SAST/SCA/secret scanning, signing-key isolation, backup + isolated restore, observability, rollback rehearsal and staged deployment. Exit: timestamped evidence, explicit operator go-live approval.

## Publishing state and invariants

`DRAFT → RENDERING → READY_FOR_REVIEW → APPROVED → SCHEDULED → PRE_PUBLISH_VALIDATION → UPLOADING → PROCESSING → PUBLISHED`.

Terminal/exceptional states: `REJECTED`, `APPROVAL_EXPIRED`, `AUTH_REQUIRED`, `PERMISSION_BLOCKED`, `RETRY_WAITING`, `FAILED`, `CANCELLED`, `UNKNOWN_REMOTE_STATUS`.

Approval must bind exact media hash, caption/metadata version, account, platform, privacy/disclosure choices and approving actor/time. Changing any bound field invalidates approval. On timeout after remote mutation, reconcile remote status before retry; never blindly republish. Store UTC; display the creator's selected timezone. Preserve existing tenant RLS and canonical error envelopes.

## Acceptance criteria and release evidence

- Windows install, upgrade, rollback and uninstall tested on a clean Windows 11 runner or documented manual test host.
- No provider secret in desktop binary, logs or CI artifacts; OAuth revocation and expiry tested.
- Media fixture renders 9:16 video with correct subtitle timing and licensed-asset provenance.
- Unapproved or changed content cannot publish; approval revocation and account mismatch fail closed.
- Scheduled job survives worker restart; duplicate queue delivery and ambiguous provider timeout do not duplicate posts.
- Every enabled platform passes contract tests **and** documented entitlement checks; unavailable APIs remain visibly blocked.
- Commission figures expose source, freshness and settlement status; cross-tenant isolation tests pass.
- `npm run check`, `npm test`, relevant security scans, Windows packaging, migration compatibility and isolated backup/restore have linked timestamped evidence.
- Staging E2E and rollback drill pass before an operator-authorized production release.

## Agent execution contract

Read `AGENTS.md` and `EXEC-PLANNING.md` first. Implement **one bounded slice per PR** with code, deterministic tests, security analysis, documentation, changelog, rollback and CI evidence. Never treat this planning-only document as implementation evidence. Do not force merge, publish externally or assert production readiness without verified gates.
