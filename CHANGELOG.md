## v1.0.1 – E2E Stability & Test Hardening (Current Sprint)
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
