# ZEAZ Affiliate — Feature Catalog / สถานะฟีเจอร์

> อัปเดตเอกสาร: 28 กันยายน 2026 · Source baseline: `main@34bfb9be6a485c8a72fbd28eacba50d89392dae3`. ตารางนี้ตรวจจาก Repository และเอกสารที่เกี่ยวข้อง **ไม่ใช่ผล UAT ของเว็บไซต์จริง** ที่ `https://zaff.zeaz.dev/`. หน้าเว็บที่มีชื่อฟีเจอร์ไม่ได้รับประกันว่าเชื่อมต่อ API/ข้อมูลจริงครบแล้ว

## ความหมายของสถานะ

- **Implemented (source)** — พบ implementation ใน Repository; ยังต้องแยกตรวจ deployed configuration, integration และ tenant authorization.
- **Partial / UI** — มี code หรือหน้าจอบางส่วน แต่ขั้นตอนสำคัญยังเป็น placeholder, fixture หรือไม่ครบ end-to-end.
- **Permission-gated** — มี adapter/contract แต่การใช้งานจริงต้องมี provider credential, scope, review หรือ account-specific authorization.
- **Scaffold** — โครงสร้างเริ่มต้น ไม่ใช่ application ที่ผ่าน installation/UAT.
- **Verification required** — มีองค์ประกอบพื้นฐานแต่ยังขาด release-grade evidence โดยเฉพาะบน `zaff.zeaz.dev`.

## Control Plane (เมนูที่มีอยู่ใน Source)

| Surface / route | Source | สถานะที่แสดงอย่างถูกต้อง | ก่อนเปิดใช้จริง |
|---|---|---|---|
| Dashboard `/dashboard` | `apps/web/src/pages/Dashboard.jsx` | Partial / UI; ใช้ API summary, trend, integration/worker health | production data providers และ session จริง |
| Autopilot Review `/autopilot-review` | `apps/web/src/pages/AutopilotReview.jsx` | Implemented: read-only review, filter, note และ export JSON | notes ยังเป็น in-memory ไม่ใช่ approval ledger |
| Campaigns `/campaigns` | `packages/affiliate-core/`, `packages/db/src/campaign-repo.js` | Implemented (domain/API); UI integration needs verification | tenant-scoped E2E |
| Publications `/publications` | `packages/workflow/`, publishing boundaries | Partial / UI | real adapter entitlement + reconciliation |
| Conversions `/conversions` | `packages/db/src/conversion-reconciliation-repo.js` | Implemented (domain/API) | live provider reconciliation |
| Connections `/connections` | `apps/web/src/pages/Connections.jsx` | Partial / UI: page describes connectors | real OAuth/session/account linkage |
| Products & Offers `/products` | `packages/affiliate-core/`, `packages/adapters/src/shopee-th-normalizer.js` | Implemented (domain/import); UI partial | feed freshness and enabled partner scopes |
| Creators & CRM `/creators` | `packages/outreach/`, `packages/affiliate-core/` | Implemented (domain); UI verification required | consent, tenant and channel policies |
| Affiliate Links `/links` | `/go/:slug`, durable affiliate core | Implemented (domain/API) | live destination, disclosure and attribution E2E |
| Content Studio `/content` | `packages/ai-content/`, `apps/web/src/pages/Content.jsx` | Partial / UI; LLM/media interface exists; placeholder video output | real FFmpeg worker, asset rights and storage |
| Publishing `/publishing` | `packages/workflow/`, `apps/web/src/pages/Publishing.jsx` | Partial / UI; page is currently a description | end-to-end calendar and provider credentials |
| Outreach `/outreach` | `packages/outreach/` | Implemented (domain/policy) | channel consent and actual delivery verification |
| Approval Center `/workflows` | `packages/workflow/`, `apps/web/src/pages/Workflows.jsx` | Implemented (workflow core); production verification required | authenticated browser session, immutable media/account binding |
| Attribution Funnel `/analytics` | `packages/analytics/` | Implemented (analytics model); site data not verified | provider-reported event ingestion and operator authorization |
| Commissions & Margin `/commissions` | `packages/analytics/`, affiliate commission reconciliation | Implemented (domain); provider confirmation pending | distinguish pending/confirmed/reversed/paid |
| Billing & Usage `/billing` | `packages/identity-billing/` | Implemented (domain); UI verification required | payment/ledger reconciliation |
| Audit Log `/audit` | `packages/contracts/src/audit.js`, audit persistence | Implemented (domain); UI verification required | append-only retention and real actor/session |
| Security & Incidents `/security` | security module, CodeQL and runbooks | Partial / UI | Code Scanning Alert #2 triage and incident evidence |
| Settings `/settings` | web control plane | Partial / UI | authenticated tenant settings + durable storage |
| Operator Console `/admin` | control-plane API and web | Partial / UI | RBAC/ABAC, sensitive action audit and real auth |

Route labels reflect repository navigation, **not verified live routes on the production domain**. ตรวจรายละเอียดใน `apps/web/src/main.jsx`, `apps/web/src/pages/`, `apps/api/` และ `docs/release/PRODUCTION-RELEASE-GATE.md`.

## Backend / automation capabilities

| Capability | Source-backed scope | Release limitation |
|---|---|---|
| Identity & tenancy | auth API, OAuth/OIDC contracts, tenant-scoped PostgreSQL RLS, RBAC/ABAC | production browser session handoff / cross-tenant UAT not closed |
| Affiliate commerce | product, offer, immutable price/commission snapshots, affiliate link, click, conversion, commission | authorized live feed/settlement required |
| Shopee Thailand import | CSV normalization and durable product/offer ingestion | importer is not Shopee Video/Live publishing permission |
| Campaigns | lifecycle and durable persistence | live business flows must be exercised |
| Webhooks | signature/replay/dedupe boundaries, normalized events, durable outbox | verify each configured provider credential/event family |
| Workflow | policy gate, approvals, idempotency, retries, DLQ, kill switches | immutable creative-level approval and remote uncertain-outcome tests outstanding |
| Outreach | CRM, consent/suppression, quiet hours, budgets and scheduled follow-up | official provider permission; no unsupported DM automation |
| AI-assisted content | provider-neutral LLM/image/voice/video interfaces, budgets, templates and moderation | `video-factory.js` produces placeholder media; real render not completed |
| Intelligence | rules-first scoring, freshness and provenance; model interface | don't imply live ML predictions or actual ROI |
| Analytics | event taxonomy, attribution, metric formulas, source classification | distinguish first-party/estimated/provider-confirmed observations |
| Billing | plans, entitlements, metering and ledger models | live payment-provider cutover requires independent proof |
| Self-host infrastructure | Node.js 22, React/Vite, PostgreSQL, Redis, Docker Compose, Cloudflare-facing deployment plan | `zaff.zeaz.dev` TLS/access/live telemetry not verified this pass |
| Windows Desktop | Tauri 2 scaffold, PowerShell bootstrap | unsigned, CSP/session/packaged API origin/Windows CI pending |

## Provider integration — capability != live permission

| Provider | Repository scope | Live-operation boundary |
|---|---|---|
| TikTok Shop | canonical signed client, resource adapters and webhook contract | partner app/product scope and test credentials required |
| TikTok Content Posting | content publishing contract | app review, `video.publish`, creator consent and commercial disclosure |
| Shopee Affiliate | signed client, Thai CSV product-feed normalization | country/account partner scope verification |
| Shopee Video / Live | planned/manual-handoff boundary | separate officially documented entitlement; **not** included in affiliate feed access |
| Lazada | signed adapter boundary | live account authorization and quota verification |
| Facebook / Instagram Reels | Meta publishing boundary | approved permissions, Page/account token and processing reconciliation |
| YouTube Shorts | YouTube publishing boundary | OAuth `videos.insert`, quota/audit and upload restrictions |
| LINE | messaging/consent capability | official channel permission and suppression/consent proof |
| MoneyPrinterTurbo | server-side content-generation adapter contract | private worker, object storage and render E2E required |

Source: [Provider Capability Matrix](PROVIDER-CAPABILITY-MATRIX.md), [Windows Delivery Contract](architecture/WINDOWS-AFFILIATE-AUTOPILOT.md) and [MoneyPrinterTurbo integration](MONEYPRINTER-INTEGRATION.md).

## สิ่งที่ยังยืนยันไม่ได้บน zaff.zeaz.dev

ไม่สามารถดึงหน้าเว็บใช้งานจริงเพื่อตรวจ Screenshot, Content Security Policy, User Login, Permissions, Runtime API Status หรือ Browser E2E ในรอบนี้ จึงไม่ถือว่า Implementation ใน Repo เท่ากับบริการจริง การปล่อย Production ต้องมี evidence ตาม [Production Release Gate](release/PRODUCTION-RELEASE-GATE.md) และต้องตรวจ GitHub Security Alert #2 แบบมีสิทธิ์ก่อน.

> **Badge semantics:** CI, CodeQL และ Dependency Review badges แสดงผลของ GitHub Workflow บน `main` เท่านั้น ไม่ใช่การรับรอง production readiness, pentest หรือ provider API approval.
