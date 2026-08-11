# Project: InvoSmart Phase 1 Near-Term Completion

## Architecture
Next.js 15 App Router, TypeScript, Prisma ORM (PostgreSQL schema), Vitest, MAP protocol.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Audit Log API | GET endpoint `/api/admin/audit-log/route.ts` returning AuditLog entries | M1 | ORIGINAL_REQUEST |
| 2 | Invoice Audit Logging | `logAuditEvent()` calls in `app/api/invoices/route.ts` & `[id]/route.ts` | M1 | ORIGINAL_REQUEST |
| 3 | Auth Audit Logging | `logAuditEvent()` calls for auth sign-in / sign-out events | M1 | ORIGINAL_REQUEST |
| 4 | Admin UI Integration | Admin panel links to or displays Audit Log data | M1 | ORIGINAL_REQUEST |
| 5 | TypeScript Compilation | `npx tsc --noEmit` clean compilation | M2 | ORIGINAL_REQUEST |
| 6 | Test Suite Stability | `npm run test` 100% passing | M2 | ORIGINAL_REQUEST |
| 7 | Knowledge Graph | `graphify update .` refresh | M3 | ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Audit Log API & Instrumentation | Audit Log endpoint, invoice & auth log hooks, admin UI link | none | DONE |
| M2 | TS & Test Verification | `npx tsc --noEmit` and `npm run test` verification | M1 | DONE |
| M3 | Graphify Refresh | `graphify update .` knowledge graph update | M2 | DONE |

## Interface Contracts
### Audit Log API
- GET `/api/admin/audit-log` -> `{ success: true, data: AuditLog[] }` or `AuditLog[]` array response with limit/query support.
- AuditLog Schema Model in `prisma/schema.prisma`: `id`, `action`, `userId`, `details`/`metadata`, `createdAt`, `ipAddress`, etc.

## Code Layout
- API Routes: `app/api/admin/audit-log/route.ts`, `app/api/invoices/route.ts`, `app/api/invoices/[id]/route.ts`
- Security/Audit Utilities: `lib/audit.ts` or `lib/security/audit.ts` (or similar helper if existing)
- Admin UI: `app/admin/...` or `app/(admin)/...` or components under `components/admin/`
