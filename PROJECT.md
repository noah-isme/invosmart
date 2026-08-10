# Project: InvoSmart Phase 1 Near-Term Priority Implementation

## Architecture
- **Optimizer Engine (`lib/ai/content-local-optimizer.ts`)**: Contextual Bandit Model evaluating CTR, conversions, dwell time, baseline metrics, and global content signals. [COMPLETED]
- **Webhook Alerts (`lib/ai/webhooks.ts` & `lib/ai/approval-gates.ts`)**: Real-time Discord/Slack alerts for auto-actions (`AUTOPUBLISH`, `SCHEDULE_UPDATE`, `AUTO_REVERT`). [COMPLETED]
- **Federation Bus (`lib/federation/bus.ts` & `lib/federation/protocol.ts`)**: Asymmetric digital signing (RSA/Ed25519) and hybrid payload encryption (AES-256-GCM). [COMPLETED]
- **PostgreSQL & Migrations (`prisma/schema.prisma`, `prisma/migrations/`, `docs/DATABASE.md`)**: PostgreSQL schema compatibility, `prisma migrate dev` workflow, versioned migrations folder, and configuration docs.
- **Security & Headers (`lib/security/csrf.ts`, `middleware.ts`, `next.config.ts`)**: CSRF token validation on mutating API routes (POST/PUT/DELETE) and strict Content-Security-Policy (CSP) headers.
- **Audit Logging (`lib/audit/auditLogger.ts`, `app/api/admin/audit-logs/`, `app/admin/audit-logs/`)**: Structured DB audit logging for invoice operations, auth events, AI auto-actions, and admin panel log viewer/query API.
- **Database & Verification (`prisma/schema.prisma` & test suites)**: Single/composite query indexes, Vitest test suite pass, `npx tsc --noEmit` pass, Playwright E2E tests, and Graphify updates.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Contextual Bandit Scoring & Selection | LinUCB / Contextual UCB reward scoring & dynamic confidence calculation in content-local-optimizer.ts | M1 | ORIGINAL_REQUEST.md & ROADMAP.md |
| 2 | Discord Webhook Alerts | Embed notification payload formatting & dispatch on AiAutoAction mutations | M2 | ORIGINAL_REQUEST.md & ROADMAP.md |
| 3 | Slack Webhook Alerts | Block Kit notification payload formatting & dispatch on AiAutoAction mutations | M2 | ORIGINAL_REQUEST.md & ROADMAP.md |
| 4 | Asymmetric Federation Bus Encryption & Signing | RSA/Ed25519 signature verification + AES-256-GCM hybrid payload encryption in bus.ts & protocol.ts | M3 | ORIGINAL_REQUEST.md & ROADMAP.md |
| 5 | PostgreSQL Prisma Migrations Workflow | PostgreSQL schema setup, `prisma migrate dev` workflow, migration files in `prisma/migrations/`, and `docs/DATABASE.md` | M4 | ORIGINAL_REQUEST.md |
| 6 | CSRF Protection & Content-Security-Policy | CSRF middleware/helper for mutating routes (POST/PUT/DELETE) and strict CSP headers in Next.js app | M5 | ORIGINAL_REQUEST.md |
| 7 | Comprehensive Audit Logging | Audit log DB model (`AuditLog`), utility `logAuditEvent()`, handlers on invoice CRUD/auth/AI auto-actions, and admin panel viewer | M6 | ORIGINAL_REQUEST.md |
| 8 | Test Suite Stability & Knowledge Graph | Vitest unit tests pass (`npm run test`), TypeScript check (`npx tsc --noEmit`), and `graphify update .` succeeds | M7 | ORIGINAL_REQUEST.md |

## Milestones
| # | Name | Scope | Dependencies | Status | Sub-Orchestrator Conv ID |
|---|------|-------|-------------|--------|-------------------------|
| M1 | Contextual Bandit Migration | lib/ai/content-local-optimizer.ts & related tests | None | DONE | a95a0d83-9a5f-49ff-bf3a-59015f0fff08 |
| M2 | Real-time Webhook Alerts | lib/ai/webhooks.ts, lib/ai/approval-gates.ts, & related tests | None | DONE | 9d0c2307-244a-4534-bc5e-c88d1198183b |
| M3 | Federation Bus Asymmetric Encryption | lib/federation/bus.ts, lib/federation/protocol.ts, & related tests | None | DONE | 44cdfc86-be4d-4c1a-ad9f-10398eb4d692 |
| M4 | PostgreSQL Migration & Proper DB Migrations | prisma/schema.prisma, prisma/migrations/, docs/DATABASE.md, docs/ARCHITECTURE.md | M1-M3 | IN_PROGRESS | 5cf8e0be-3f3e-4034-881f-67fd16a7c173 |
| M5 | CSRF Protection & Content-Security-Policy | lib/security/csrf.ts, middleware.ts, next.config.ts, mutating API routes | M4 | DONE | fc7bdacf-c5d1-4410-92c2-f2aa4b19d553 |
| M6 | Comprehensive Audit Logging | prisma/schema.prisma, lib/audit/auditLogger.ts, API routes, Admin panel UI | M4 | IN_PROGRESS | c93aab65-da27-472d-8f5c-d4344eb60b39 |
| M7 | Test Suite Stability & Verification Hardening | Vitest test suites, TypeScript compilation, Playwright E2E, graphify update . | M4, M5, M6 | IN_PROGRESS | 78b5deb2-fab4-4e25-9e53-642e67f45755 |

## Interface Contracts

### M1 ↔ AI Engine [COMPLETED]
- `synthesiseVariantPayload(...)`: Returns variant payload + contextual bandit confidence score + AI explanation.
- `recordVariantPerformance(...)`: Accepts variant performance metrics and updates contextual bandit prior weights / reward bounds.

### M2 ↔ Approval Gates / Auto Actions [COMPLETED]
- `dispatchWebhookAlert(action: AiAutoAction)`: Asynchronously dispatches formatted Discord embed & Slack Block Kit payloads to `DISCORD_WEBHOOK_URL` / `SLACK_WEBHOOK_URL`. Degrades gracefully on missing URLs or HTTP errors.

### M3 ↔ Federation Protocol [COMPLETED]
- `FederationEvent`: Augmented schema supporting asymmetric digital signatures (`signature`), encrypted payload (`encryptedPayload`), AES key (`encryptedKey`), IV (`iv`), and key ID (`keyId`).
- `deliver(...)` / `ingest(...)`: Asymmetric digital signature generation/verification (`crypto.sign`/`crypto.verify`) and hybrid payload encryption/decryption (`aes-256-gcm`).

### M4 ↔ Database & Migration Workflow
- `prisma/schema.prisma`: PostgreSQL provider support via `DATABASE_URL` environment variable.
- `prisma/migrations/`: Versioned migration directory managed via `prisma migrate dev`.
- `docs/DATABASE.md`: Documentation for PostgreSQL setup, migration procedure, and environment variables.

### M5 ↔ CSRF & Security Headers
- `lib/security/csrf.ts`: CSRF token generation & validation helpers for API routes.
- `middleware.ts` / `next.config.ts`: CSRF token validation on POST/PUT/DELETE routes & strict Content-Security-Policy (CSP) headers.

### M6 ↔ Audit Logging System
- `AuditLog` Prisma Model: `id`, `tenantId`, `userId`, `action`, `entity`, `entityId`, `details` (JSON), `ipAddress`, `createdAt`.
- `logAuditEvent(...)`: Helper function invoked in invoice creation/update/deletion, auth routes, and AI auto-actions.
- `app/api/admin/audit-logs/route.ts` & Admin Panel UI: Query endpoint with filters (action, entity, date range) and UI component in admin panel.

### M7 ↔ Verification & Quality
- All unit tests passing (`npm run test`), zero TypeScript errors (`npx tsc --noEmit`), graph updated (`graphify update .`).

## Code Layout
- `lib/ai/content-local-optimizer.ts`: Milestone M1 [COMPLETED].
- `lib/ai/webhooks.ts` & `lib/ai/approval-gates.ts`: Milestone M2 [COMPLETED].
- `lib/federation/bus.ts` & `lib/federation/protocol.ts`: Milestone M3 [COMPLETED].
- `prisma/schema.prisma`, `prisma/migrations/`, `docs/DATABASE.md`: Owned by Milestone M4.
- `lib/security/csrf.ts`, `middleware.ts`, `next.config.ts`: Owned by Milestone M5.
- `lib/audit/auditLogger.ts`, `app/api/admin/audit-logs/`, `app/admin/audit-logs/`: Owned by Milestone M6.
- `test/`, `e2e/`, project root: Milestone M7.

