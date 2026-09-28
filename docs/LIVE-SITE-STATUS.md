# zaff.zeaz.dev — Live Site Verification Boundary

Updated: 2026-09-28 · Source baseline: `34bfb9be6a485c8a72fbd28eacba50d89392dae3`.

This page tracks **deployment verification**, not what the repository can theoretically implement. The website URL is [https://zaff.zeaz.dev/](https://zaff.zeaz.dev/). During this documentation update a direct webpage fetch was unavailable; therefore no claim of successful login, live dashboard data, provider authorization, browser E2E, uptime, Cloudflare Access or TLS configuration is made.

| Verification | Status | Evidence required |
|---|---|---|
| Source CI on baseline `main` | Verified success at 2026-09-28 02:23 UTC | [CI run](https://github.com/cvsz/zaffiliate/actions/runs/36369627468) |
| Source CodeQL workflow on same SHA | Verified success at 2026-09-28 02:23 UTC | [CodeQL run](https://github.com/cvsz/zaffiliate/actions/runs/36369627488); does not prove Alert #2 is closed |
| Live website responds and serves exact release SHA | NOT VERIFIED | TLS curl, version endpoint, deployment manifest |
| Authenticated browser session & tenant isolation | BLOCKED / NOT VERIFIED | login/logout/expiry, CSRF and cross-tenant negative E2E |
| Real Dashboard, Jobs, Approvals, Analytics, Billing | NOT VERIFIED | authenticated tenant-scoped API evidence; no fixture fallback |
| TikTok/Shopee/Meta/YouTube production publishing | PERMISSION-GATED | official scope and real-account sandbox/staging evidence per provider |
| Windows installed client | SCAFFOLD ONLY | Windows CI, valid CSP, packaged API origin, signing, UAT |
| Backup/isolated restore and rollback | RELEASE GATE OPEN | timed restore, migration replay, data integrity and tested rollback |
| Security Alert #2 | UNTRIAGED HERE | authenticated GitHub alert details, fix PR and fresh scan |

**Blocker source of truth:** [Production Release Gate](release/PRODUCTION-RELEASE-GATE.md). Nothing in this page authorizes publishing, customer traffic or legacy cutover.
