# 🚀 InvoSmart

> **Smart AI Invoice & Insight Platform**

![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)

Welcome to **InvoSmart**, a premium, developer-friendly platform for managing invoices and gaining insights powered by AI.

---

## 🛠 Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript 5.9
- **Library:** React 18
- **Styling:** Tailwind CSS v4
- **Database ORM:** Prisma ORM
- **Caching/Redis:** Upstash Redis

---

## 📋 Prerequisites

Before you begin, ensure you have met the following requirements:

- **Node.js**: 24 LTS
- **npm**: 9+
- **Database**: PostgreSQL (managed via Prisma ORM, see `docs/DATABASE.md`)
- **Optional**: 
  - Upstash Redis account
  - OpenAI API key
  - Google OAuth credentials
  - PostHog account (Analytics)
  - Sentry account (Error Tracking)

---

## ⚡ Quick Start

Follow these steps to get the project up and running locally on dev port **1234**:

```bash
git clone <repo>
cd invosmart
npm install
cp .env.example .env
# Edit .env with your specific values
npx prisma migrate dev  # Run Prisma migrations
npm run db:seed         # Optional: seed sample data
npm run dev      # → http://localhost:1234
```

---

## 📜 Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `npm run dev` | Start dev server on port 1234 |
| `build` | `npm run build` | Production build |
| `start` | `npm start` | Start production server |
| `lint` | `npm run lint` | ESLint check |
| `test` | `npm run test` | Vitest unit tests |
| `test:e2e` | `npm run test:e2e` | Playwright E2E tests (excludes `@staging`) |
| `test:e2e:smoke` | `npm run test:e2e:smoke` | Playwright `@smoke` subset |
| `test:e2e:contract` | `npm run test:e2e:contract` | No-DB contract gate (app server only) |
| `test:e2e:staging` | `npm run test:e2e:staging` | `@staging` specs against `PLAYWRIGHT_BASE_URL` |
| `test:integration` | `npm run test:integration` | Vitest DB integration layer |
| `e2e:build` | `npm run e2e:build` | Production build for e2e (see below) |
| `e2e:db` | `npm run e2e:db` | In-memory PGlite Postgres server for e2e |
| `e2e:stub` | `npm run e2e:stub` | Local provider stub server for e2e |
| `e2e:db:probe` | `npm run e2e:db:probe` | PGlite connection probes (needs `e2e:db` running) |
| `e2e:report` | `npm run e2e:report` | Open the Playwright HTML report |
| `db:push` | `npm run db:push` | Push Prisma schema to database |
| `db:studio` | `npm run db:studio` | Open Prisma Studio GUI |
| `db:seed` | `npm run db:seed` | Seed database |
| `qa:lighthouse` | `npm run qa:lighthouse` | Run Lighthouse audit |
| `release` | `npm run release` | Trigger semantic release |

---

## 🔐 Environment Variables

[`.env.example`](./.env.example) is the single, commented reference for every variable the app reads: what each does, whether it is required, and per-environment notes. Copy it to `.env` and fill in what you need. CI runs `npm run docs:env-check`, which fails when code reads a variable that `.env.example` does not list.

- **Platform admins** are configured with `ADMIN_USER_IDS` (user ids, not emails). See [docs/WORKSPACE_RBAC.md](./docs/WORKSPACE_RBAC.md#platform-administrators).
- **Staging / production values** and secret handling: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) and [SECURITY.md](./SECURITY.md).
- ⚠️ `INVOSMART_E2E_PROVIDER_BASE_URL` is **test-only; never set it in a deployed environment** ([docs/E2E_TESTING.md](./docs/E2E_TESTING.md)).

---

## 📁 Project Structure

```text
invosmart/
├── app/                  # Next.js App Router pages & API routes
│   ├── api/             # Route handlers (see API Reference below)
│   ├── app/             # Authenticated app pages (dashboard, invoices, clients, workspaces, admin, settings)
│   ├── auth/            # Login/register pages
│   ├── devtools/        # AI monitoring dashboards (platform admins)
│   ├── receipts/        # Public receipt verification
│   └── share/           # Public signed invoice links
├── components/          # React UI components (auth, invoices, layout, payments, telemetry, ui)
├── context/             # React contexts (theme, toast, AI optimizer)
├── emails/              # React Email templates
├── hooks/               # Custom React hooks
├── lib/                 # Core business logic
│   ├── ai/              # AI agent modules (docs/ai/)
│   ├── api-v1/          # Customer API auth, rate limits, idempotency
│   ├── audit/           # Audit logging
│   ├── federation/      # Cross-tenant FDP protocol
│   ├── payments/        # Stripe / Midtrans checkout & settlement
│   ├── security/        # CSRF, CSP
│   ├── team/            # Workspaces, reminders, Slack delivery
│   └── …                # cache, email, i18n, invoices, monitoring, receipts, stats
├── middleware/          # Request middleware helpers
├── prisma/              # Database schema, migrations & seeds
├── scripts/             # Release, e2e and docs tooling
├── server/              # NextAuth configuration
├── test/                # Integration, e2e (Playwright) and extra unit tests
├── types/               # TypeScript declarations
├── docs/                # Documentation (index: docs/README.md)
└── public/              # Static assets
```

---

## ✨ Key Features

- 🧾 **Invoice CRUD**: Seamless creation and management with auto-numbering.
- 🤖 **AI Invoice Composer**: Convert natural language directly into structured invoices.
- 📸 **AI Receipt Scanner**: Extract structured data from receipt images effortlessly.
- 📄 **PDF Export**: Generate professional invoices with custom branding.
- 📊 **Dashboard**: Comprehensive revenue analytics and insights.
- 🧠 **AI Optimization**: Advanced 6-agent AI system for intelligent automation.
- 🎨 **Modern Design**: Sleek dark/light glassmorphism UI.
- 🔒 **Authentication**: Secure NextAuth integration with Google OAuth.
- 📈 **Observability**: Built-in Sentry error tracking and PostHog analytics.
- 🚀 **CI/CD**: Streamlined Vercel deployment pipeline.
- 🔄 **Invoice Templates**: Save and reuse invoice templates per-user.
- 📥 **CSV / Excel Export**: Download invoice lists in multiple formats.
- 🌐 **i18n**: Multi-language support (English + Indonesian) with per-user locale.
- 📉 **Bayesian A/B Stats**: Statistical significance analysis for A/B experiments.
- 🚩 **Feature Flags**: Runtime feature toggles per-tenant with admin UI.
- 🏥 **Uptime Monitoring**: Endpoint health checks with alerts.
- 💳 **Payment Lifecycle**: Idempotent Midtrans/Stripe checkout with signed webhook reconciliation.
- ✉️ **Invoice Delivery**: Retryable Resend delivery with signed status webhooks and payment links.

---

## 🌐 API Reference

Route handlers live under `app/api/`. This is an index by domain; the linked docs are the contracts.

| Domain | Route prefixes | Reference |
|--------|----------------|-----------|
| **Auth** | `/api/auth/[...nextauth]`, `/api/auth/register` | [SECURITY.md](./SECURITY.md) |
| **Invoices** | `/api/invoices`, `/api/invoices/[id]` (+ `/pdf`, `/send-email`), `/api/invoices/export` (CSV, or `?format=xlsx` for an Excel 2003 XML Spreadsheet served as `.xml`), `/api/invoices/templates/*`, `/api/invoices/ai`, `/api/clients/*` | session API, workspace-scoped |
| **Payments** | `/api/payments`, `/api/payments/[attemptId]`, `/api/payments/{stripe,midtrans}/*` | [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) |
| **Public share** | `/api/share/checkout` (checkout from the invoice share link, authorised by the share token, no session) | [SECURITY.md](./SECURITY.md#public-links), [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md#payments) |
| **Workspaces & team** | `/api/workspaces/*` (members, invitations, API keys, notifications, reminder rules), `/api/workspace-invitations/[token]/accept` | [docs/WORKSPACE_RBAC.md](./docs/WORKSPACE_RBAC.md) |
| **Customer API v1** | `/api/v1/invoices/*`, `/api/v1/clients/*`, `/api/openapi.json` | [docs/API.md](./docs/API.md) |
| **Receipts** | `/api/receipts/*` | |
| **AI / optimizer** | `/api/ai/*`, `/api/ai-optimizer/*`, `/api/opt/*`, `/api/insight/revenue`, `/api/federation/status` | [docs/ai/](./docs/ai/) |
| **Admin / platform** | `/api/admin/*` (feature flags, uptime, audit logs), `/api/devtools/*`, `/api/dev/perf/summary` | [docs/WORKSPACE_RBAC.md](./docs/WORKSPACE_RBAC.md#platform-administrators) |
| **User settings** | `/api/user/{locale,theme,branding}` | |
| **Cron** | `/api/cron/{uptime,reminders,reminder-delivery}` (Vercel Cron, every 5 min, `CRON_SECRET`) | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| **Webhooks** | `/api/payments/stripe/webhook`, `/api/payments/midtrans/notification`, `/api/webhooks/resend` | [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) |
| **Health** | `/api/health` (shallow), `/api/health?db=1` (adds a database ping; the uptime cron's default probe) | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |

---

## 🔐 Authentication

InvoSmart uses [NextAuth.js](https://next-auth.js.org/) for robust and secure authentication. 
- **Flow**: Session-based authentication integrated tightly with Next.js App Router.
- **Route Protection**: Middleware requires a session for `/app/*`; `/devtools/*` and global admin pages/APIs additionally require platform-admin identity (`ADMIN_USER_IDS`) enforced in the page, API route or server action itself.
- **Providers**: Out-of-the-box support for Google OAuth. Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to enable social login.

---

## 🧠 AI Agent System

The core intelligence of InvoSmart is driven by a sophisticated 6-agent AI architecture designed to optimize, learn, govern, and federate tasks autonomously. 
For a deep dive into the AI mechanics, refer to the following documentation:
- [Architecture Details](docs/ARCHITECTURE.md)
- [AI subsystem docs](docs/ai/)
- [Agent & contributor instructions](AGENTS.md)

---

## 🧪 Testing

We ensure reliability through comprehensive testing:
- **Unit Tests**: Powered by Vitest. Run using `npm run test`.
- **E2E Tests**: Powered by Playwright against a real in-memory Postgres (PGlite) and a local provider stub; no `.env`, database or provider account needed. Requires Node 24 and `npx playwright install chromium`.
- **`e2e:build`**: runs `next build` with the fixed e2e `NEXT_PUBLIC_*` values and writes `.next/e2e-build.json` (a fingerprint of those values plus `git rev-parse HEAD`) so the Playwright config can detect a stale build. `next/font` fetches Google Fonts at build time, so `e2e:build` (like `npm run build`) needs network access. A plain `npm run build` removes the stamp.
- **Coverage**: We maintain high coverage expectations across core business logic (`lib/`) and UI components (`components/`).

```bash
npm run e2e:build            # once per code change (~3 min); E2E_APP_PORT=<port> if 3000 is busy, same value for the run
npm run test:e2e:smoke       # @smoke tier (PR gate)
npm run test:e2e             # full local tier (everything except @staging)
npm run test:integration     # Vitest DB integration layer (own PGlite)
npm run test:e2e:contract    # no-DB browser contract gate
npm run test:stub            # provider stub self-tests
npm run test:db-support      # DB guard, schema helper and pglite-server filter tests
npm run typecheck:e2e        # typecheck test/e2e and playwright.config.ts
node scripts/e2e-coverage-check.mjs   # every page and API route has a scenario or a waiver
```

Architecture, environment, tiers, CI budgets, how to add a scenario and the known expected failures: [docs/E2E_TESTING.md](docs/E2E_TESTING.md).

---

## 🚀 Deployment

InvoSmart deploys to Vercel from GitHub Actions ([`.github/workflows/release.yml`](./.github/workflows/release.yml)):
- **Pushes to `main` and PRs to `main`** run `build-and-test` (release check, Prisma validate, lint, `docs:env-check`, `docs:route-check`, `docs:link-check`, typecheck, unit tests, DB integration tests, build) and the `e2e-smoke` Playwright tier. The full e2e tier runs nightly ([`e2e-full.yml`](./.github/workflows/e2e-full.yml)).
- **A push to `main`** then runs `release` (semantic-release). When it publishes a version (`feat:`/`fix:` commits since the last `v*` tag), `deploy` ships that release commit (`vercel deploy --prod`) and the `@staging` tier runs. Pushing a tag deploys nothing.
- **Database migrations** are applied by the `deploy` job (`prisma migrate deploy`, before `vercel deploy`) using the `PRODUCTION_DATABASE_URL` secret of the `production` GitHub environment, which the repository owner creates (direct, non-pooled connection string).
- **Crons** (`vercel.json`): `/api/cron/uptime`, `/api/cron/reminders`, `/api/cron/reminder-delivery`, every 5 minutes.

Release order, rollback and verification: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md). Staging certification: [docs/runbooks/release-certification.md](./docs/runbooks/release-certification.md).

---

## 🤝 Contributing

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`, `test/…`) and use [Conventional Commits](https://www.conventionalcommits.org/) (semantic-release reads them).
2. Before pushing, run the same gates CI runs:
   ```bash
   npm run lint && npm run typecheck && npm run test && npm run docs:env-check && npm run docs:route-check && npm run docs:link-check
   ```
   Run `npm run test:integration` / `npm run test:e2e:smoke` when you touch the database or user flows.
3. Open a PR to `main` and fill in the [PR template](./.github/pull_request_template.md), including which docs you updated (see "Saat mengubah X, perbarui Y" in [AGENTS.md](./AGENTS.md)).
4. `build-and-test` and `e2e-smoke` must be green before merge. Docs and security-sensitive paths are owned per [CODEOWNERS](./.github/CODEOWNERS).

---

## 📚 Documentation Index

The full index is [docs/README.md](docs/README.md). Start with:

- 🏗️ [Architecture Overview](docs/ARCHITECTURE.md)
- 🚀 [Deployment](docs/DEPLOYMENT.md)
- 🔒 [Security & privacy](SECURITY.md)
- 👥 [Workspaces & RBAC](docs/WORKSPACE_RBAC.md)
- 🧪 [E2E testing](docs/E2E_TESTING.md)
- 🤖 [Agent & contributor instructions](AGENTS.md)

---

## 📄 License

This project is licensed under the **MIT** License.
