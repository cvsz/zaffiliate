# ZEAZ Affiliate — Documentation Index

> อัปเดต 28 กันยายน 2026 · เอกสารทางเทคนิคบางชุดเป็น Historical Baseline ของวันที่ระบุในไฟล์ ไม่ใช่สถานะ Production ปัจจุบัน. ให้ยึด [Production Release Gate](release/PRODUCTION-RELEASE-GATE.md) และหลักฐานบน Exact Commit ก่อนเปิดใช้จริง.

## Start here

| Document | ใช้ทำอะไร |
|---|---|
| [Root README](../README.md) | ภาพรวม, Dynamic GitHub Badges, Quick Start, Website และ Desktop |
| [Feature Catalog](FEATURES.md) | ความสามารถทั้งหมด, Code References, สถานะ UI / Backend / Provider |
| [Architecture](../ARCHITECTURE.md) | Domain Boundaries, PostgreSQL RLS, Workflow, Outbox, AI/Analytics |
| [Development](DEVELOPMENT.md) | Local Bootstrap, Quality Gates, Tests |
| [Execution Planning](../EXEC-PLANNING.md) | Canonical Slice Tracker และ Phase-Gated Acceptance |
| [Roadmap](../ROADMAP.md) | งานที่ต้องพัฒนา/ตรวจสอบต่อ |

## Product domains

- [Affiliate Commerce](AFFILIATE-COMMERCE.md): Product, Offer, Pricing, Promotions, Commission Freshness.
- [Analytics](ANALYTICS.md): Event Source Classification, Attribution, Conversion, Revenue Formula.
- [Intelligence](INTELLIGENCE.md): Rules-First Ranking, Feature Freshness, Model Interfaces.
- [Provider Capability Matrix](PROVIDER-CAPABILITY-MATRIX.md): API/Permission Boundaries and Manual Fallback.
- [Shopee Thailand](SHOPEE-PRODUCT-EXPORT.md): CSV/Product Feed; ไม่ได้หมายถึงสิทธิ์ Shopee Video/Live.
- [TikTok Review](TIKTOK-APP-REVIEW.md): App Review, Scope and Sandbox Evidence.
- [MoneyPrinterTurbo](MONEYPRINTER-INTEGRATION.md): Server-Side Content Generation Contract.
- [YouTube Factory](YOUTUBE-FACTORY.md): Provider Workflow and Constraints.

## Desktop & branding

- [Windows Delivery Contract](architecture/WINDOWS-AFFILIATE-AUTOPILOT.md)
- [AUTO-WIN-01 Acceptance](architecture/AUTO-WIN-01-ACCEPTANCE.md)
- [Desktop Setup](../apps/desktop/README.md)
- [Social Preview](brand/social-preview.svg) / [Branding & Upload](brand/README.md)
- [Live Site Verification](LIVE-SITE-STATUS.md)

## Safety & operations

- [Security](../SECURITY.md)
- [Production Release Gate](release/PRODUCTION-RELEASE-GATE.md)
- [Historical Readiness Checklist](PRODUCTION-READINESS.md)
- [Operations](../OPERATIONS.md)
- [Implementation Checklist](../IMPLEMENTATION-CHECKLIST.md)
- [Changelog](../CHANGELOG.md)

**Source implementation, passing GitHub Actions and functioning Customer Production are three different evidence categories.** ตรวจใน Feature Catalog ก่อนเขียนคำโฆษณาหรือเปิด Provider Publishing.
