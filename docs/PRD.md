# InvoSmart: Product Requirements Document (PRD)

## 1. Executive Summary
InvoSmart is a Next.js 15 (App Router) SaaS web application designed to empower freelancers and small businesses in Indonesia with intelligent invoice creation, management, and analytics. Powered by a sophisticated multi-agent AI system, it automates mundane tasks like invoice composition from natural language and multi-modal receipt parsing. By blending standard financial operations with cutting-edge AI features—such as content optimization and predictive insights—InvoSmart aims to be the "Smart AI Invoice & Insight Platform" for the modern Indonesian business.

## 2. Problem Statement
Freelancers and small to medium businesses (SMBs) in Indonesia often rely on fragmented, manual, or overly complex tools to manage their invoicing and cash flow. Existing solutions are either too rigid or lack the intelligence to help businesses understand their financial health. Furthermore, creating professional invoices, tracking receipts, and analyzing financial data are time-consuming tasks that distract from core business activities. There is a need for a localized, intelligent, and seamless platform that automates these processes and provides actionable insights.

## 3. Target Users
- **Primary Audience:** Indonesian freelancers, solopreneurs, and Small to Medium Businesses (SMBs).
- **Locale:** Indonesia (`id_ID`).
- **Currency:** Indonesian Rupiah (IDR).
- **User Pain Points:** Time lost on manual invoice creation, difficulty tracking overdue payments, lack of actionable financial insights, and scattered receipt management.

## 4. Product Vision
To be the definitive "Smart AI Invoice & Insight Platform" for Indonesian freelancers and SMBs by seamlessly integrating traditional financial management with autonomous AI agents that save time, accelerate payments, and optimize business decisions.

## 5. Feature Requirements

### P0 - Core System & Minimum Viable Product (MVP)
| Feature | Description | Acceptance Criteria |
|---------|-------------|---------------------|
| **User Authentication** | Secure sign-up/sign-in via NextAuth.js. | Supports credentials and optional Google OAuth. Passwords hashed with bcrypt, cost 10 (`lib/hash.ts`). Google sign-in is rejected unless Google asserts `email_verified: true` (`server/auth.ts:173`). Signup also provisions a personal workspace in the same transaction. |
| **Invoice Management (CRUD)** | Create, Read, Update, Delete invoices. | Statuses: `DRAFT`, `SENT`, `PAID`, `UNPAID`, `OVERDUE` (`prisma/schema.prisma`, `InvoiceStatus`). Numbers are `INV-YYYYMM-NNN`, unique per workspace (`generateInvoiceNumber`, `lib/schemas.ts`). Tax rate defaults to 10% and can be overridden per invoice (`taxRate`, `lib/schemas.ts:46`). Line items stored as JSON. A `SENT`/`UNPAID` invoice past its due date becomes `OVERDUE` when read. |
| **Dashboard & Cashflow Board** | Centralized view of financial health. | Live cashflow metrics, Recharts visualizations for revenue (paid/overdue), and status filters. |
| **PDF Export** | Pure JS generation of invoices via pdf-lib. | Custom branding (logo, colors, fonts) and status badges (e.g., PAID, OVERDUE). |
| **Settings & Branding** | Configure company profile and UI preferences. | Dark/light mode (Glassmorphism UI), custom primary/accent colors. Changes sync with PDF exports. |

### P0 - Business Operations (shipped August 2026)
| Feature | Description | Acceptance Criteria |
|---------|-------------|---------------------|
| **Workspaces & Roles** | Multi-user workspaces with role-based access. | Every signup gets a personal workspace with the user as `OWNER`. Users can create more workspaces and switch the active one (`/api/workspaces`, `/api/workspaces/switch`). Roles `OWNER`/`ADMIN`/`MEMBER`/`VIEWER` follow the matrix in [WORKSPACE_RBAC.md](./WORKSPACE_RBAC.md). Resources outside the active workspace return `404`, and a missing membership returns `403`. |
| **Team Invitations** | Invite people to a workspace by email. | `OWNER`/`ADMIN` can invite as `ADMIN`/`MEMBER`/`VIEWER`, but an `ADMIN` cannot invite an `ADMIN`. Tokens are stored only as SHA-256 digests, expire after 7 days and can be claimed once, only by a signed-in user whose email matches. Owner memberships cannot be changed or removed. |
| **Clients** | A client directory linked to invoices and templates. | CRUD at `/api/clients` and `/app/clients`. Client email is unique per workspace. |
| **Online Payments** | Pay invoices through Stripe Checkout or Midtrans Snap. | `MEMBER`+ can start a checkout. Repeated requests for the same invoice and provider return the active attempt. A client-supplied `Idempotency-Key` returns the attempt created with it, and reusing it after that attempt has finished returns `409`. Attempts expire after 30 minutes. Midtrans accepts only IDR invoices, and unsupported currencies are rejected with `422`. The amount and currency sent to the provider are fixed when the attempt is created. |
| **Payment Reconciliation & Refunds** | Provider webhooks keep invoices in sync. | Webhooks are rejected unless the signature verifies (Stripe `stripe-signature`, Midtrans SHA-512). Events are deduplicated by provider event ID. Only forward lifecycle transitions are applied (see [DATABASE.md §4.13](./DATABASE.md#413-lifecycles)). Settlement marks the invoice `PAID` exactly once across providers. A duplicate settlement is flagged for refund instead of recorded. Partial refunds accumulate on the payment, and a full refund moves the invoice back to `UNPAID`. |
| **Invoice Delivery by Email** | Send an invoice with a signed payment link via Resend. | `POST /api/invoices/[id]/send-email` (`MEMBER`+). Transient failures are retried, up to 4 attempts per recipient. Every attempt is logged on the invoice, and Resend delivery-status webhooks are verified before they are stored (`/api/webhooks/resend`). |
| **Public Share Links** | View an invoice without signing in. | `/share/[id]?token=…` renders only when an HMAC-SHA256 token (`INVOICE_SHARE_SECRET`, falling back to `NEXTAUTH_SECRET`) verifies for that invoice. Tokens expire after 7 days by default. A production deployment with no secret refuses to issue tokens. |
| **Invoice Reminders** | Automatic payment reminders by email and Slack. | `OWNER`/`ADMIN` define rules: an offset of −365…365 days from the due date, and channels `EMAIL`/`SLACK`. A cron every 5 minutes creates one occurrence per invoice and rule (idempotent key), and a second cron delivers per channel with retries (5 attempts; backoff 5 min, 15 min, 1 h, 6 h). Reminders are suppressed once the invoice is paid. Slack webhook URLs are stored encrypted. |
| **Customer API v1 & API Keys** | Workspace-scoped REST API for invoices and clients. | `OWNER`/`ADMIN` create keys with the scopes `invoices:read`, `invoices:write`, `clients:read` and `clients:write` (read-only by default). The secret is shown once and stored as a hash. Expired or revoked keys return `401`, and a missing scope returns `403`. Creates require `Idempotency-Key`. Responses are rate-limited. The OpenAPI document is served at `/api/openapi.json`. Full contract: [API.md](./API.md). |
| **Receipt Verification** | Anyone can verify a payment receipt. | Each receipt has a unique number and a verification token. The public page `/receipts/[id]/verify` confirms authenticity, and verification events are written to the receipt audit trail. |
| **Invoice Templates** | Reusable invoice bodies. | Save, list, rename, delete and instantiate templates per workspace (`/api/invoices/templates`). |
| **CSV / Excel Export** | Download filtered invoice lists. | `GET /api/invoices/export` returns `.csv`, or with `?format=xlsx` an Excel 2003 XML Spreadsheet served as `.xml` (opens in Excel; not in Numbers or Google Sheets). Available to every role, including `VIEWER`. |
| **Localization** | English and Indonesian UI. | Locale is stored per user (`/api/user/locale`) and selected in `/app/settings/language`. |
| **Feature Flags & Uptime (platform admin)** | Runtime toggles and health monitoring. | Only platform admins (`ADMIN_USER_IDS`) can manage flags (with tenant/user targeting) and uptime checks. A cron runs uptime checks every 5 minutes and alerts by webhook on downtime. |

### P1 - AI Intelligence & Automation
| Feature | Description | Acceptance Criteria |
|---------|-------------|---------------------|
| **AI Invoice Composer** | Generate invoices from natural language prompts. | Page at `/app/ai-invoice`, backed by `POST /api/invoices/ai`. Uses Gemini when `GEMINI_API_KEY` is set, otherwise OpenAI (`lib/ai.ts`), to produce structured invoice data. |
| **Receipt Management** | Multi-modal receipt scanning and digital generation. | Base64 image to parsed data. Generates receipts with SHA-256 verification tokens, company seals, paid stamps, and signatures. Includes Audit Trail. |
| **AI Optimization Engine** | A/B testing and content optimization. | Local per-content testing (Hook, Caption, CTA, Schedule). Global cross-content learning (7d/30d windows). Variant scoring with a LinUCB contextual bandit (`lib/ai/content-local-optimizer.ts`) and Bayesian A/B statistics (`lib/ai/bayesian-ab.ts`). Semi-autonomous auto-publish with approval gates. |
| **Multi-Agent AI System** | 6 specialized agents communicating via MAP protocol. | Agents (Optimizer, Learning, Governance, Recovery, Insight, Federation) operate autonomously with adaptive scaling. |
| **Admin Panel & DevTools** | Monitor and control AI operations. | 7 DevTools pages for AI monitoring, audit, autonomy, federation, learning, tuning, and performance. Admin can view experiment dashboards and manual revert capabilities. |

### P2 - Advanced Observability & Enhancements
| Feature | Description | Acceptance Criteria |
|---------|-------------|---------------------|
| **System Observability** | Monitoring and analytics integrations. | Sentry (error tracking, tracing) and PostHog (analytics, RUM) implemented. Core Web Vitals monitored. |
| **Advanced Database Schema** | Comprehensive relational models via Prisma. | Support for LearningProfile, AgentEventLog, AgentPriority, RecoveryLog, FederationMetrics, ContentExperiment, AiAutoAction, etc. |

## 6. Non-Functional Requirements

### Performance
- **Page Load:** `< 2s` across standard connections.
- **Lighthouse Score:** `> 90` across Performance, Accessibility, Best Practices, and SEO.

### Security
- **Authentication:** NextAuth sessions using the JWT strategy (`session: { strategy: "jwt" }`, `server/auth.ts:208`). The customer API uses workspace-scoped API keys instead of sessions.
- **Password Hashing:** bcrypt with a salt round of 10.
- **Data Validation:** Strict schema validation using Zod on both client and server.
- **Infrastructure Protection:** Rate limiting, strict HTTPS enforcement, and secure HTTP headers.

### Development & Quality Assurance
- **Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Prisma ORM.
- **Testing:** Unit testing via Vitest; End-to-End (E2E) testing via Playwright. Target `> 80%` test coverage.
- **CI/CD:** Automated pipelines via GitHub Actions, Semantic Release for versioning, and deployment to Vercel.
- **Internationalization (i18n):** Deeply integrated Indonesian locale (`id_ID`) formatting for dates, currencies, and numbers.

## 7. Success Metrics
- **Performance:** Maintain `< 2s` load time and `> 90` Lighthouse accessibility score.
- **Quality:** Maintain `> 80%` test coverage.
- **Business/Scale (Target Landing Page KPIs):** 
  - 12K+ invoices processed via the platform.
  - $8.2M+ total transaction value managed.
- **User Adoption:** High utilization rate of AI Composer and Receipt Scanner among weekly active users (WAU).

## 8. Glossary
- **MAP Protocol:** The internal messaging and orchestration protocol used by the Multi-Agent AI system to communicate.
- **LinUCB:** A contextual-bandit algorithm that picks variants by an upper confidence bound on expected reward. The AI Optimization Engine uses it for variant selection (`lib/ai/content-local-optimizer.ts`).
- **Bayesian A/B statistics:** Beta-Binomial posterior analysis (probability B beats A, expected loss, credible intervals) shown on the DevTools experiments page (`lib/ai/bayesian-ab.ts`).
- **Glassmorphism:** A UI design style that uses translucent, blurred backgrounds to create a 'frosted glass' effect.
- **RUM (Real User Monitoring):** Passive monitoring technology used in PostHog to record user interactions with the application.
