# Scope: Milestone M6 (Comprehensive Audit Logging)

## Objectives
1. Implement `AuditLog` model in `prisma/schema.prisma` (`id`, `tenantId`, `userId`, `action`, `entity`, `entityId`, `details`, `ipAddress`, `createdAt`).
2. Create helper `lib/audit/auditLogger.ts` (`logAuditEvent(...)`) for structured log persistence.
3. Instrument audit log calls across:
   - Invoice CRUD operations (create, update, delete)
   - Auth events (sign-in, sign-out)
   - AI auto-actions (`AUTOPUBLISH`, `SCHEDULE_UPDATE`, `AUTO_REVERT` in approval gates/loop)
4. Add admin API route at `/api/admin/audit-logs` (or `/api/admin/audit-log`) to retrieve and filter audit entries (by action, entity, date range).
5. Add admin UI page at `/app/admin/audit-logs/` (or `/app/admin/audit-log/`) with filter controls.
6. Add unit and integration tests verifying audit log creation and API query capabilities.
7. Verify `npx tsc --noEmit` and `npm run test` pass without errors.

## Code Boundaries
- `prisma/schema.prisma`
- `lib/audit/auditLogger.ts`
- `lib/ai/approval-gates.ts` / `lib/ai/loop.ts` / AI auto-action modules
- Invoice API / server actions / route handlers
- Auth API / sign-in / sign-out handlers
- `app/api/admin/audit-logs/route.ts` (or `app/api/admin/audit-log/route.ts`)
- `app/admin/audit-logs/page.tsx` (or `app/admin/audit-log/page.tsx`)
- Test files under `lib/audit/__tests__/` or `app/api/admin/audit-logs/__tests__/` or `lib/__tests__/`
