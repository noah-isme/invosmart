# Original User Request

## 2026-08-10T17:58:31Z

Execute Phase 1 Near-Term Priority items from docs/ROADMAP.md for InvoSmart codebase (/home/noah/project/invosmart).

Working directory: /home/noah/project/invosmart
Integrity mode: development

## Requirements

### R1. Contextual Bandit Model Migration
Migrate the content optimization engine in lib/ai/content-local-optimizer.ts from local heuristic/template-based bandit scoring to a contextual bandit model incorporating contextual features (impressions, click-through-rate, dwell time, conversion rate).

### R2. Real-time Webhook Alerts
Implement Discord & Slack webhook notification support in lib/ai/webhooks.ts and connect it to ai_auto_actions so admin alerts are dispatched upon auto-publish, schedule updates, or auto-reverts.

### R3. Federation Bus Asymmetric Encryption
Implement asymmetric payload encryption/signing for the cross-tenant Federation Data Protocol (FDP) bus in lib/federation/bus.ts to ensure data privacy and authenticity.

### R4. Database & Verification Hardening
Ensure Prisma migrations and PostgreSQL configurations are verified, and run test suites to guarantee zero regression on core financial and agent protocol behavior.

## Acceptance Criteria

### Verification & Quality
- [ ] All Vitest unit tests pass (npm run test)
- [ ] TypeScript compilation and build succeeds without errors (npm run build)
- [ ] E2E Playwright tests pass (npm run test:e2e)
- [ ] Codebase knowledge graph updated via graphify update .

## 2026-08-11T01:59:35Z

Complete the remaining Phase 1 Near-Term items for InvoSmart (`/home/noah/project/invosmart`). M1 (Contextual Bandit), M2 (Webhook Alerts), and M3 (Federation Encryption) are already implemented and tested.

Working directory: `/home/noah/project/invosmart`
Integrity mode: `development`

## Context

- Stack: Next.js 15, TypeScript, Prisma ORM (SQLite dev / PostgreSQL prod), Vitest, Redis, MAP multi-agent protocol
- All Vitest tests currently passing (283 tests)
- Existing Prisma schema is at `prisma/schema.prisma`; DB migrations use `prisma db push` (to be upgraded)
- AGENTS.md contains architecture and development guidelines

## Requirements

### R1. PostgreSQL Migration & Proper DB Migrations
Migrate the database setup from SQLite (`db push`) to a proper Prisma migration workflow (`prisma migrate dev`). The schema must remain compatible. Add a `DATABASE_URL` environment variable configuration targeting PostgreSQL, and document setup steps in `docs/ARCHITECTURE.md` or a new `docs/DATABASE.md`.

### R2. CSRF Protection & Content-Security-Policy
Implement CSRF protection for all mutating API routes and add a strict Content-Security-Policy header across the Next.js application. Existing API routes must not break.

### R3. Comprehensive Audit Logging
Implement audit logging for all significant user actions (invoice create/update/delete, auth events, AI auto-actions). Logs must be persisted to the database and queryable from the admin panel.

### R4. Test Suite Stability
Ensure all Vitest unit tests continue to pass after the above changes (`npm run test`). Fix any regressions introduced. TypeScript must compile without errors (`npx tsc --noEmit`).

## Acceptance Criteria

### Verification & Quality
- [ ] `npm run test` exits 0 — all tests pass, no regressions
- [ ] `npx tsc --noEmit` exits 0 — no TypeScript errors
- [ ] Prisma migration files exist under `prisma/migrations/`
- [ ] At least one CSRF middleware or token validation is active on POST/PUT/DELETE routes
- [ ] CSP header appears in Next.js config or middleware
- [ ] Audit log entries are created for invoice and auth actions (verifiable- [ ] AuditLog model in schema and API route returns entries
- [ ] `graphify update .` runs successfully

## 2026-08-11T02:20:30Z

Resume Phase 1 Near-Term item implementation for InvoSmart (`/home/noah/project/invosmart`).

Working directory: `/home/noah/project/invosmart`
Integrity mode: `development`

## Already Completed (do NOT redo)
- M1: Contextual Bandit Model (lib/ai/content-local-optimizer.ts) ✅
- M2: Discord/Slack Webhook Alerts (lib/ai/webhooks.ts) ✅  
- M3: Federation Bus RSA/AES-256-GCM Encryption (lib/federation/bus.ts) ✅
- All 282 Vitest tests passing ✅
- Prisma migration file created: prisma/migrations/20260811000000_init_postgresql_schema/ ✅
- middleware.ts exists with CSRF/CSP headers ✅

## Remaining Requirements

### R1. Complete PostgreSQL Migration Setup
Verify the Prisma migration is correct and complete. Ensure `prisma/schema.prisma` uses `provider = "postgresql"` with a `DATABASE_URL` env var. Add documentation in `docs/DATABASE.md` covering how to run migrations and set up the dev database. The migration file already exists — verify it matches the full schema.

### R2. Verify CSRF & CSP Implementation
Verify middleware.ts correctly implements CSRF token validation for POST/PUT/DELETE routes and that a Content-Security-Policy header is set in next.config.ts or middleware. Fix any gaps.

### R3. Comprehensive Audit Logging
Implement audit logging for significant user actions: invoice create/update/delete, auth sign-in/sign-out, and AI auto-actions. Logs must be persisted to the database (add an `AuditLog` model to Prisma schema if not present) and be queryable from the admin panel. Add a basic admin UI page or API route at `/api/admin/audit-log` to retrieve recent audit entries.

### R4. Test Suite Stability
After all changes, run `npm run test` and fix any regressions. TypeScript must compile without errors (`npx tsc --noEmit`).

## Acceptance Criteria
- [ ] `npm run test` exits 0 — all tests pass
- [ ] `npx tsc --noEmit` exits 0 — no TypeScript errors
- [ ] `prisma/schema.prisma` uses `provider = "postgresql"`
- [ ] Prisma migration files exist under `prisma/migrations/`
- [ ] `docs/DATABASE.md` explains PostgreSQL setup
- [ ] CSRF protection active on mutating routes
- [ ] CSP header present in next.config.ts or middleware
- [ ] AuditLog model in schema and API route returns entries


## 2026-08-11T02:36:35Z

Resume Phase 1 Near-Term completion for InvoSmart (`/home/noah/project/invosmart`).

Working directory: `/home/noah/project/invosmart`
Integrity mode: `development`
Max concurrent workers: 2

## Already Completed — Do NOT redo
- M1: Contextual Bandit (LinUCB) ✅
- M2: Discord/Slack Webhook Alerts ✅
- M3: Federation Bus RSA/AES-256-GCM ✅
- PostgreSQL migration: `prisma/migrations/20260811000000_init_postgresql_schema/` ✅
- CSRF protection: `lib/security/csrf.ts` + `middleware.ts` ✅
- CSP headers: `next.config.ts` ✅
- `docs/DATABASE.md` ✅
- `AuditLog` model in `prisma/schema.prisma` ✅
- 299 Vitest tests passing ✅

## Remaining Requirements

### R1. Audit Log API & Admin Integration
Verify or implement `/api/admin/audit-log/route.ts` — a GET endpoint returning recent audit log entries from the database. If the `AuditLog` schema model exists but there are no write calls yet, add `logAuditEvent()` calls to invoice API routes (`app/api/invoices/route.ts`, `app/api/invoices/[id]/route.ts`) and auth events. Ensure entries can be retrieved and the admin panel links to the audit log page.

### R2. TypeScript Compilation Check
Run `npx tsc --noEmit` and fix any TypeScript errors introduced by the Phase 1 changes.

### R3. Test Suite Stability
After all changes, run `npm run test` and ensure all tests pass (no regressions). Then run `graphify update .` to refresh the knowledge graph.

## Acceptance Criteria
- [ ] `npm run test` exits 0
- [ ] `npx tsc --noEmit` exits 0
- [ ] `/api/admin/audit-log` endpoint exists and returns JSON array of audit entries
- [ ] At least one `logAuditEvent()` call exists in invoice API routes
- [ ] `graphify update .` succeeds

## Constraints
- Use max 2 concurrent workers to conserve API quota
- Run `npm run test` continuously after each change to catch regressions immediately

