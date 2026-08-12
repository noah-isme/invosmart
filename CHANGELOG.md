## v1.2.0 – Phase 2: Features & Ecosystem Expansion (2026-08-12)
- 🔄 **Recurring Invoice Templates**: Save invoices as reusable templates; manage (list, rename, delete) and instantiate per-user (`app/api/invoices/templates/`, `app/app/invoices/templates/`)
- 📥 **CSV / Excel Export**: Download invoice lists as `.csv` or `.xlsx` from any filtered view (`lib/export-utils.ts`, `app/api/invoices/export/`)
- 🌐 **i18n Framework**: English (`en`) + Indonesian (`id`) with per-user locale persistence and settings UI (`lib/i18n/`, `app/api/user/locale/`, `app/app/settings/language/`)
- 📊 **Bayesian A/B Statistics**: Beta-Binomial posterior analysis — P(B>A), expected loss, 95% credible intervals — overlaid on DevTools experiments page (`lib/ai/bayesian-ab.ts`)
- 🚩 **Feature Flags System**: Runtime per-tenant/user feature toggles with Prisma-backed storage, admin UI, and typed `getFlag()` helper (`lib/feature-flags.ts`, `app/app/admin/feature-flags/`)
- 🏥 **Uptime Monitoring**: Cron-based health checks with latency tracking, admin dashboard, and webhook alerts on downtime (`lib/monitoring/uptime.ts`, `app/app/admin/uptime/`)
- 🗃️ Prisma migration `20260811171520_add_m0_phase2_models` adding `InvoiceTemplate`, `FeatureFlag`, `UptimeCheck` models and `locale` field on `User`
- ✅ 408+ Vitest tests (↑96 from v1.1.0)

- 🐛 Fixed test helper exports and typescript routing compatibility (moved `buildPaymentsWhere` to a dedicated utility file)
- 📝 Added `AGENTS.md` to document Multi-Agent Architecture, MAP Protocol, and developer instructions
- ⚙️ Configured local PostgreSQL container setup for dev/test environments and synced Prisma schema
- 🛡️ Fixed E2E HTTPS enforcement bypass to support HTTP localhost tests in production mode
- 🌐 Fixed Server Component relative URL fetch errors by defaulting base URL to `NEXTAUTH_URL` or `localhost:3000`
- 🎯 Fixed strict-mode violations in Playwright by refining selectors with `.first()`
- 🔗 Wrapped invoice number and client name in the dashboard table with Next.js Link component for click-through details

## v1.0.0 – Launch Release
- 🎨 Complete AI theme & branding sync
- 📊 Added AI-powered insights
- 🧾 PDF and dashboard fully integrated
- 🚀 Production telemetry and CI/CD pipeline
