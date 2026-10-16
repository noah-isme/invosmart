## [Unreleased]

> semantic-release (`.releaserc.json`) generates versioned entries when a release is tagged. This section was written by hand because no release has been tagged since v1.2.0: the Semantic Release step in `.github/workflows/release.yml` is disabled (`if: false`) until Phase 8 of `.plans/tech-stack-upgrade.md`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Added
- **Payments**: Stripe Checkout and Midtrans Snap with idempotent payment attempts, signed webhook reconciliation, append-only `PaymentEvent` history, refunds, and cross-provider protection against settling one invoice twice (`lib/payments/`, `app/api/payments/`).
- **Invoice delivery**: Resend email delivery with retries, signed payment and share links, and verified delivery-status webhooks (`/api/webhooks/resend`).
- **Workspaces & RBAC**: personal workspaces created at signup, `OWNER`/`ADMIN`/`MEMBER`/`VIEWER` roles, workspace switching, member management and email invitations (`lib/workspaces.ts`, `/api/workspaces/*`). See `docs/WORKSPACE_RBAC.md`.
- **Team operations**: invoice reminder rules with per-channel (email/Slack) delivery, retries and suppression once paid. Slack endpoints are stored encrypted. Two new crons: `/api/cron/reminders` and `/api/cron/reminder-delivery`.
- **Customer API v1**: workspace-scoped `/api/v1` invoices/clients API with scoped API keys, `Idempotency-Key` support, rate limiting and `/api/openapi.json` (`docs/API.md`).
- **Release certification**: `npm run release:check` / `release:certify` gates (`docs/RUNBOOK_RELEASE_CERTIFICATION.md`).
- Client module, multi-currency invoices and PWA support.

### Changed
- The runtime moved to Node.js 24. Idempotency keys and rate limits are now shared across instances through Upstash Redis.
- The invoice detail page loads data directly instead of fetching its own API. Auto-overdue is now atomic.
- Performance: fixed an N+1 query and memory leaks, and added indexes (`20260827070000_add_performance_indexes`).
- The OpenAPI spec now matches the implementation.

### Fixed
- Payments: correct line items sent to Stripe and Midtrans; Stripe minor units for IDR; non-IDR invoices rejected on Midtrans; settlement serialised per attempt; manual `PAID` handled; Stripe refunds for attempts without a `Payment`; fully refunded payments ignored when detecting duplicate settlement.
- Workspaces: personal workspace provisioned at signup, provisioning race locked, and a safe backfill script for stranded users (`npm run db:backfill-workspaces`).
- `/app-settings` now requires a session.

### Security
- Platform admin access is keyed on `ADMIN_USER_IDS` (user ids). `ADMIN_EMAILS` / `NEXT_PUBLIC_ADMIN_EMAILS` are deprecated and ignored.
- Google sign-in requires a verified email and no longer auto-links to password accounts.
- The AI explain endpoint is restricted to platform admins. Federation status fails closed when no token secret is configured.
- CSRF double-submit works in edge middleware and browser clients, with signed provider webhooks exempt and a rotated cookie name. CSP allows Midtrans Snap.
- Scheduled uptime checks require a `CRON_SECRET` bearer token.

### Testing
- New end-to-end suite: Playwright against an in-memory PGlite Postgres and a loopback provider stub, organised into `@smoke`, full and `@staging` tiers, with persona fixtures and API factories (`docs/E2E_TESTING.md`).
- A Vitest DB integration layer (`npm run test:integration`), a route-coverage check with waivers (`scripts/e2e-coverage-check.mjs`), and an e2e typecheck.
- CI: an `e2e-smoke` PR job, a nightly `e2e-full` workflow, staging-tier wiring, and the e2e typecheck in CI.

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
