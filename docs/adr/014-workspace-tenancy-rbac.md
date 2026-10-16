# 14. Workspace Tenancy and Role-Based Access

## Status
Accepted (2026-10-16, recorded retroactively).

## Context
Business data was originally owned by individual users (`userId`). Teams needed shared invoices, clients, reminders, payments and API keys, with different permissions per person. Platform administration had been granted by email allowlists (`ADMIN_EMAILS`), but registration does not verify email ownership, so anyone could register an allowlisted address.

## Decision
- **Tenancy model**: **Organization** (workspace) plus **Membership**, with four roles: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (`prisma/schema.prisma:39-44`). Migration `20260813120000_workspace_rbac_foundation` adds these as additive columns and tables.
- **Permissions**: one capability matrix (`lib/workspaces.ts:53-58`). OWNER and ADMIN get read, write, `manage_members` and `manage_workspace`. MEMBER gets read and write. VIEWER gets read only.
- **Tenant resolution**: always server-side from a verified membership (`resolveWorkspaceContext`). Queries are scoped with `workspaceScope()`, and a client-supplied organization id is never trusted as a filter.
- **Rollout**: controlled by `WORKSPACE_AUTH_MODE`. `compat` (default) keeps the legacy user-owned fallback. `enforce` fails closed. Switch only after the personal-workspace backfill (`npm run db:backfill-workspaces`).
- **Platform admins**: identified by `User.id` values in `ADMIN_USER_IDS` (`lib/devtools/access.ts`), never by email. `ADMIN_EMAILS` and `NEXT_PUBLIC_ADMIN_EMAILS` are deprecated and ignored. Workspace roles never grant global access.

## Consequences
### Positive
*   **Teams**: a team shares data with least-privilege roles.
*   **Additive migration**: rollback is an application rollback. The new columns can stay in place.
*   **Admin access is tied to identity**: it no longer depends on an unverified email.

### Negative / Trade-offs
*   **Two data paths during `compat`**: workspace-scoped and user-scoped rows coexist until `enforce` is switched on.
*   **Dual model**: every new business resource must carry `organizationId` and use `workspaceScope()`, or it leaks across tenants.
*   **Rules not in the matrix**: some role rules live in individual routes rather than the matrix (ADMIN cannot grant ADMIN; owners cannot be changed). These must be documented in [WORKSPACE_RBAC.md](../WORKSPACE_RBAC.md).
