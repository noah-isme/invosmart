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

- **Node.js**: 18.18+ or 20+
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
| `test:e2e` | `npm run test:e2e` | Playwright E2E tests |
| `db:push` | `npm run db:push` | Push Prisma schema to database |
| `db:studio` | `npm run db:studio` | Open Prisma Studio GUI |
| `db:seed` | `npm run db:seed` | Seed database |
| `qa:lighthouse` | `npm run qa:lighthouse` | Run Lighthouse audit |
| `release` | `npm run release` | Trigger semantic release |

---

## 🔐 Environment Variables

Ensure the following environment variables are correctly configured in your `.env` file:

### App
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `CRON_SECRET` (required in production for scheduled uptime checks)
- `NEXT_PUBLIC_APP_VERSION`

### Observability
- `ENABLE_TELEMETRY`
- `NEXT_PUBLIC_ENABLE_TELEMETRY`

### Analytics
- `NEXT_PUBLIC_POSTHOG_KEY`
- `POSTHOG_API_KEY`
- `SENTRY_DSN`

### OAuth
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

### Database
- `DATABASE_URL`

### AI
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

### AI Agents
- `ENABLE_AI_OPTIMIZER`
- `ENABLE_AI_LEARNING`
- `ENABLE_AI_GOVERNANCE`
- `ENABLE_AI_AUTONOMY`
- `ENABLE_AI_FEDERATION`
- `AI_SA_MAX_AUTOPUBLISH_PER_DAY`

### Media
- `CLOUDINARY_URL`

### Deployment
- `VERCEL_TOKEN`
- `RESEND_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `STRIPE_WEBHOOK_SECRET`
- `MIDTRANS_SERVER_KEY`

---

## 📁 Project Structure

```text
invosmart/
├── app/                  # Next.js App Router pages & API routes
│   ├── api/             # REST API endpoints
│   ├── app/             # Authenticated app pages
│   ├── auth/            # Login/register pages
│   ├── devtools/        # AI monitoring dashboards
│   └── receipts/        # Receipt verification
├── components/          # React UI components
│   ├── auth/           # Auth components
│   ├── invoices/       # Invoice form components
│   ├── layout/         # Shell, sidebar, topbar
│   ├── telemetry/      # Analytics provider
│   └── ui/             # Reusable UI primitives
├── context/            # React contexts (theme, toast, AI)
├── hooks/              # Custom React hooks
├── lib/                # Core business logic
│   ├── ai/            # AI agent modules (20+ files)
│   ├── cache/         # Redis/memory cache
│   ├── federation/    # Cross-tenant FDP protocol
│   ├── i18n/          # Internationalization (en, id)
│   ├── monitoring/    # Uptime health checks
│   ├── receipts/      # Receipt service
│   └── stats/         # Statistical utilities
├── middleware/         # Request middleware
├── prisma/            # Database schema & seeds
├── server/            # Server-side auth config
├── types/             # TypeScript declarations
├── test/              # Test files
├── docs/              # Documentation
└── public/            # Static assets
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

| Domain | Endpoint | Method | Description |
|--------|----------|--------|-------------|
| **Auth** | `/api/auth/[...nextauth]` | GET/POST | NextAuth endpoints |
| **Invoices** | `/api/invoices` | GET/POST | List or create invoices |
| | `/api/invoices/[id]` | GET/PUT/DELETE | Invoice CRUD |
| | `/api/invoices/[id]/send-email` | POST | Send an invoice with a signed payment link |
| | `/api/invoices/export` | GET | Export invoices as CSV/XLSX |
| | `/api/invoices/templates` | GET/POST | Invoice template management |
| | `/api/invoices/templates/[id]` | PUT/DELETE | Template CRUD & instantiate |
| **Payments** | `/api/payments/midtrans/create` | POST | Create or reuse an idempotent Midtrans checkout |
| | `/api/payments/stripe/create-session` | POST | Create or reuse an idempotent Stripe checkout |
| | `/api/payments/[attemptId]` | GET | Read an owned payment attempt status |
| | `/api/payments/midtrans/notification` | POST | Verify and reconcile Midtrans events |
| | `/api/payments/stripe/webhook` | POST | Verify and reconcile Stripe events |
| **Webhooks** | `/api/webhooks/resend` | POST | Verify and persist Resend delivery events |
| **AI** | `/api/ai/composer` | POST | Natural language to invoice |
| | `/api/ai/scanner` | POST | Receipt image parsing |
| **Admin** | `/api/admin/feature-flags` | GET/POST | Feature flag management |
| | `/api/admin/uptime` | GET | Uptime monitoring status |
| **User** | `/api/user/locale` | GET/PATCH | User locale preference |
| **Cron** | `/api/cron/uptime` | GET | Uptime check cron trigger |
| **Health** | `/api/health` | GET | Application health check |
| **Telemetry** | `/api/telemetry` | POST | Capture custom analytics |

---

## 🔐 Authentication

InvoSmart uses [NextAuth.js](https://next-auth.js.org/) for robust and secure authentication. 
- **Flow**: Session-based authentication integrated tightly with Next.js App Router.
- **Route Protection**: Middleware ensures that `/app/*`, `/devtools/*`, and `/receipts/*` routes are protected.
- **Providers**: Out-of-the-box support for Google OAuth. Configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to enable social login.

---

## 🧠 AI Agent System

The core intelligence of InvoSmart is driven by a sophisticated 6-agent AI architecture designed to optimize, learn, govern, and federate tasks autonomously. 
For a deep dive into the AI mechanics, refer to the following documentation:
- [Architecture Details](docs/ARCHITECTURE.md)
- [Agent Specifications](AGENTS.md)

---

## 🧪 Testing

We ensure reliability through comprehensive testing:
- **Unit Tests**: Powered by Vitest. Run using `npm run test`.
- **E2E Tests**: Powered by Playwright. Run using `npm run test:e2e`.
- **Coverage**: We maintain high coverage expectations across core business logic (`lib/`) and UI components (`components/`).

---

## 🚀 Deployment

InvoSmart is optimized for deployment on Vercel:
- **Pipeline**: GitHub Actions triggers formatting, linting, and tests on PRs.
- **Deployment**: Seamless Vercel integration handles preview deployments and production builds.
- **Setup**: Ensure all necessary environment variables are loaded into the Vercel project settings prior to deployment.

---

## 🤝 Contributing

We welcome contributions! Please review our standard PR process:
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes.
4. Push to the branch.
5. Open a Pull Request.

Make sure to run `npm run lint` and `npm run test` before submitting!

---

## 📚 Documentation Index

Explore our comprehensive documentation suite:

- 📄 [Product Requirements Document (PRD)](docs/PRD.md)
- 🏗️ [Architecture Overview](docs/ARCHITECTURE.md)
- 🎨 [Design Specifications](docs/DESIGN.md)
- 🗺️ [Project Roadmap](docs/ROADMAP.md)
- ⚖️ [Architecture Decision Records (ADRs)](docs/adr/)
- 🤖 [AI Agents Guide](AGENTS.md)
- 🔄 [Changelog](CHANGELOG.md)

---

## 📄 License

This project is licensed under the **MIT** License.
