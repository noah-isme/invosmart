# Scope: Milestone M6 - Comprehensive Audit Logging

## Architecture
Comprehensive Audit Logging system across InvoSmart:
- Schema: AuditLog model in Prisma with indexes (`tenantId`, `userId`, `action`, `entity`, `entityId`, `details`, `ipAddress`, `createdAt`) and optional relation to `User`.
- Logger Helper: non-blocking `logAuditEvent(input)` and `getClientIp(req)` helper in `lib/audit/auditLogger.ts`.
- Mutation Instrumentation:
  - Invoices: `app/api/invoices/route.ts` (POST create), `app/api/invoices/[id]/route.ts` (PUT update, DELETE delete, GET auto-overdue).
  - Auth: `server/auth.ts` (NextAuth `events.signIn`, `events.signOut`, `authorize` failure logging) and `app/api/auth/register/route.ts` (POST register).
  - AI Auto-Actions: `lib/ai/approval-gates.ts` (`logAutoAction`, `markAutoActionReverted`) and `lib/ai/loop.ts` (recovery rollback).
- Admin Query API: `app/api/admin/audit-logs/route.ts` supporting filters (`action`, `entity`, `userId`, `tenantId`, `fromDate`, `toDate`, `limit`, `skip`).
- Admin Viewer UI & Layout: `app/app/admin/audit-logs/page.tsx` with filter controls, pagination, JSON details accordion; update `app/app/admin/layout.tsx` navigation and `app/app/admin/page.tsx` control center.
- Tests: `lib/audit/__tests__/auditLogger.test.ts` (unit) and `app/api/admin/__tests__/audit-logs.test.ts` (integration).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | AuditLog Schema | Prisma AuditLog model with indexes & optional User relation | M6 | User Request |
| 2 | auditLogger Helper | `lib/audit/auditLogger.ts` non-blocking try-catch logger & `getClientIp` | M6 | User Request |
| 3 | Invoice Audit Instrumentation | Invoices API (POST, PUT, DELETE, GET auto-overdue) | M6 | User Request |
| 4 | Auth Audit Instrumentation | NextAuth events (signIn, signOut, authorize failure) + register API | M6 | User Request |
| 5 | AI Auto-Actions Audit | `lib/ai/approval-gates.ts` & `lib/ai/loop.ts` recovery rollback | M6 | User Request |
| 6 | Admin Audit Logs API | `app/api/admin/audit-logs/route.ts` query API with filters & pagination | M6 | User Request |
| 7 | Admin Audit Logs UI | `app/app/admin/audit-logs/page.tsx` + layout & admin dashboard updates | M6 | User Request |
| 8 | Unit & Integration Tests | `lib/audit/__tests__/auditLogger.test.ts` & `app/api/admin/__tests__/audit-logs.test.ts` | M6 | User Request |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M6 | Comprehensive Audit Logging | Full audit log schema, helper, mutation instrumentation, query API, UI viewer, tests | M1-M5 | IN_PROGRESS |

## Code Layout
- `prisma/schema.prisma`
- `lib/audit/auditLogger.ts`
- `app/api/invoices/route.ts`
- `app/api/invoices/[id]/route.ts`
- `server/auth.ts`
- `app/api/auth/register/route.ts`
- `lib/ai/approval-gates.ts`
- `lib/ai/loop.ts`
- `app/api/admin/audit-logs/route.ts`
- `app/app/admin/audit-logs/page.tsx`
- `app/app/admin/layout.tsx`
- `app/app/admin/page.tsx`
- `lib/audit/__tests__/auditLogger.test.ts`
- `app/api/admin/__tests__/audit-logs.test.ts`
