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
| **User Authentication** | Secure sign-up/sign-in via NextAuth.js. | Supports Credentials + optional Google OAuth. Uses bcrypt (salt 10). |
| **Invoice Management (CRUD)** | Create, Read, Update, Delete invoices. | Supports DRAFT, SENT, PAID, OVERDUE statuses. Auto-numbering (INV-YYYYMM-SEQ). Tax calculation (10%). Items stored as JSON. |
| **Dashboard & Cashflow Board** | Centralized view of financial health. | Live cashflow metrics, Recharts visualizations for revenue (paid/overdue), and status filters. |
| **PDF Export** | Pure JS generation of invoices via pdf-lib. | Custom branding (logo, colors, fonts) and status badges (e.g., PAID, OVERDUE). |
| **Settings & Branding** | Configure company profile and UI preferences. | Dark/light mode (Glassmorphism UI), custom primary/accent colors. Changes sync with PDF exports. |

### P1 - AI Intelligence & Automation
| Feature | Description | Acceptance Criteria |
|---------|-------------|---------------------|
| **AI Invoice Composer** | Generate invoices from natural language prompts. | Page at `/app/ai-invoice`. Integrates with GPT-4o-mini/Gemini to produce structured invoice data. |
| **Receipt Management** | Multi-modal receipt scanning and digital generation. | Base64 image to parsed data. Generates receipts with SHA-256 verification tokens, company seals, paid stamps, and signatures. Includes Audit Trail. |
| **AI Optimization Engine** | A/B testing and content optimization. | Local per-content testing (Hook, Caption, CTA, Schedule). Global cross-content learning (7d/30d windows). Thompson Sampling-inspired scoring. Semi-autonomous auto-publish with approval gates. |
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
- **Authentication:** JWT for session management.
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
- **Thompson Sampling:** A heuristic for choosing actions that address the exploration-exploitation dilemma in the AI Optimization Engine.
- **Glassmorphism:** A UI design style that uses translucent, blurred backgrounds to create a 'frosted glass' effect.
- **RUM (Real User Monitoring):** Passive monitoring technology used in PostHog to record user interactions with the application.
