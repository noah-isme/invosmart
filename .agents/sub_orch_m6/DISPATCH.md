# Dispatch Assignment — sub_orch_m6

## 2026-08-10T19:07:57Z

<USER_REQUEST>
You are Sub-orchestrator sub_orch_m6 for Milestone M6 (Comprehensive Audit Logging).
Working directory: /home/noah/project/invosmart/.agents/sub_orch_m6
Scope document: /home/noah/project/invosmart/PROJECT.md
Read survey report: /home/noah/project/invosmart/.agents/explorer_survey_r3/handoff.md and /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md

Tasks to delegate to your Worker (worker_m6_1):
1. Add `AuditLog` model to `prisma/schema.prisma` with indexed fields (`tenantId`, `userId`, `action`, `entity`, `entityId`, `details`, `ipAddress`, `createdAt`) and optional relation to `User`.
2. Create `lib/audit/auditLogger.ts` featuring `logAuditEvent(input)` (non-blocking try-catch logger helper) and `getClientIp(req)`.
3. Instrument mutation points:
   - Invoices: `app/api/invoices/route.ts` (POST create), `app/api/invoices/[id]/route.ts` (PUT update, DELETE delete, GET auto-overdue).
   - Auth: `server/auth.ts` (NextAuth `events.signIn`, `events.signOut`, `authorize` failure logging) and `app/api/auth/register/route.ts` (POST register).
   - AI Auto-Actions: `lib/ai/approval-gates.ts` (`logAutoAction`, `markAutoActionReverted`) and `lib/ai/loop.ts` (recovery rollback).
4. Implement Admin Audit Log Query API: `app/api/admin/audit-logs/route.ts` supporting filters (`action`, `entity`, `userId`, `tenantId`, `fromDate`, `toDate`, `limit`, `skip`).
5. Implement Admin Audit Log Viewer UI: `app/app/admin/audit-logs/page.tsx` displaying paginated logs with filter controls and JSON details accordion, and update `app/app/admin/layout.tsx` navigation and `app/app/admin/page.tsx` control center.
6. Create unit test `lib/audit/__tests__/auditLogger.test.ts` and integration test `app/api/admin/__tests__/audit-logs.test.ts`.

Follow Project Pattern iteration loop: Worker -> Reviewers + Challengers -> Forensic Auditor -> Gate check (GATE_STATUS.md) -> Handoff report (handoff.md). Send completion message to parent when done.
</USER_REQUEST>
