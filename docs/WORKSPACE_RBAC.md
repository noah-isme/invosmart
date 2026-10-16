# Workspace and RBAC Runbook

owner: @noah-isme

This is the canonical authorization document. The capability matrix lives in code at `lib/workspaces.ts:52-61` (`rolePermissions`); this file explains it and must change with it.

## Model

Each account receives a personal workspace. A user may belong to multiple workspaces but has one active workspace at a time. Workspace membership is persisted in the database and is the source of truth for authorization.

The initial roles are:

| Role | Capabilities |
| --- | --- |
| `OWNER` | All business operations, workspace configuration (reminder rules, notification endpoints, API keys), and member administration. Ownership transfer is not implemented (see [Ownership rules](#ownership-rules)). |
| `ADMIN` | Workspace configuration, invitations (not as `ADMIN`), member management below owner, and all business operations |
| `MEMBER` | Create and manage invoices, clients, templates, delivery, payments, exports, and analytics |
| `VIEWER` | Read-only invoices, clients, templates, analytics, PDFs, and exports |

Signup provisions that workspace. Credentials registration (`/api/auth/register`) and first-time Google sign-in create the `User`, the personal `Organization`, the `OWNER` `Membership` and `User.activeOrganizationId` in a single transaction, in both `compat` and `enforce` modes (`createUserWithPersonalWorkspace` in `lib/workspace-provisioning.ts`); if the workspace cannot be created the user is not created either. Provisioning is idempotent and race-safe: it takes a `FOR NO KEY UPDATE` row lock on the user and a user who already has any membership is never given a second personal workspace. Only new signups are provisioned automatically; an existing user with no membership is still denied (`403`) under `enforce` until they are backfilled (see [Backfilling stranded users](#backfilling-stranded-users)). Under `compat`, such a user is still provisioned lazily on their first workspace-bound request.

The platform administrator allowlist used by DevTools is separate from workspace administration; see [Platform administrators](#platform-administrators). Workspace `OWNER`/`ADMIN` never grants access to global resources (DevTools, global feature flags, uptime, cross-tenant audit logs).

In code each role maps to permissions (`lib/workspaces.ts:52-61`): `OWNER` and `ADMIN` → `read`, `write`, `manage_members`, `manage_workspace`; `MEMBER` → `read`, `write`; `VIEWER` → `read`. Under `WORKSPACE_AUTH_MODE=compat` a user's own pre-workspace rows resolve to a `LEGACY` role with all four permissions on those rows only.

## Resource × action matrix

✅ = allowed, ❌ = denied (`403`), — = no endpoint.

| Resource | Action | OWNER | ADMIN | MEMBER | VIEWER | Enforced in |
|---|---|:-:|:-:|:-:|:-:|---|
| Invoices | view, list, PDF, export | ✅ | ✅ | ✅ | ✅ | `lib/invoices/get-invoice.ts:62`, `app/api/invoices/route.ts` (GET), `app/api/invoices/[id]/pdf/route.ts`, `app/api/invoices/export/route.ts` (`canReadWorkspace`) |
| Invoices | create, edit, delete, send email | ✅ | ✅ | ✅ | ❌ | `app/api/invoices/route.ts` (POST), `app/api/invoices/[id]/route.ts` (PUT/DELETE), `app/api/invoices/[id]/send-email/route.ts` (`canWriteWorkspace`) |
| Clients | view, list | ✅ | ✅ | ✅ | ✅ | `app/api/clients/route.ts`, `app/api/clients/[id]/route.ts` (GET, `canReadWorkspace`) |
| Clients | create, edit, delete | ✅ | ✅ | ✅ | ❌ | same files (POST/PUT/DELETE, `canWriteWorkspace`) |
| Invoice templates | view, list | ✅ | ✅ | ✅ | ✅ | `app/api/invoices/templates/route.ts`, `templates/[id]/route.ts` (GET) |
| Invoice templates | create, edit, delete, instantiate | ✅ | ✅ | ✅ | ❌ | same files (POST/PUT/DELETE), `templates/[id]/instantiate/route.ts` |
| Payments | view attempts and payments | ✅ | ✅ | ✅ | ✅ | `app/api/payments/route.ts:27`, `app/api/payments/[attemptId]/route.ts:23` |
| Payments | start checkout (Stripe/Midtrans) | ✅ | ✅ | ✅ | ❌ | `app/api/payments/stripe/create-session/route.ts:51`, `app/api/payments/midtrans/create/route.ts:48` |
| Receipts | view PDF and audit trail, AI scan | ✅ | ✅ | ✅ | ✅ | `app/api/receipts/[id]/pdf`, `[id]/audit`, `ai-scan` (`canReadWorkspace`) |
| Receipts | create | ✅ | ✅ | ✅ | ❌ | `app/api/receipts/create/route.ts:34` |
| Reminder rules | view | ✅ | ✅ | ✅ | ✅ | `app/api/workspaces/[id]/reminder-rules/route.ts` GET (membership only, no permission check) |
| Reminder rules | create, edit, delete | ✅ | ✅ | ❌ | ❌ | `reminder-rules/route.ts:20`, `reminder-rules/[ruleId]/route.ts:20` (`manage_workspace`) |
| Workspace | create a new workspace (caller becomes `OWNER`) | ✅ | ✅ | ✅ | ✅ | `app/api/workspaces/route.ts` POST (any signed-in user; no membership needed) |
| Workspace | switch active workspace | ✅ | ✅ | ✅ | ✅ | `app/api/workspaces/switch/route.ts` (membership re-checked) |
| Workspace | rename, delete | — | — | — | — | no endpoint (out of scope) |
| Members | list | ✅ | ✅ | ✅ | ✅ | `app/api/workspaces/[id]/members/route.ts:17` (`read`) |
| Members | change role, remove | ✅ | ✅ ¹ | ❌ | ❌ | `app/api/workspaces/[id]/members/[membershipId]/route.ts:19` (`manage_members`) |
| Invitations | list, create | ✅ | ✅ ² | ❌ | ❌ | `app/api/workspaces/[id]/invitations/route.ts:28` (`manage_members`) |
| Invitations | accept | n/a | n/a | n/a | n/a | `app/api/workspace-invitations/[token]/accept/route.ts:25`: any signed-in user whose session email matches the invitation |
| Invitations | revoke | — | — | — | — | no endpoint (`revokedAt` exists in the schema) |
| API keys | list, view, create, edit, revoke | ✅ | ✅ | ❌ | ❌ | `app/api/workspaces/[id]/api-keys/route.ts:54`, `api-keys/[keyId]/route.ts:55` (`manage_workspace`) |
| Slack / notification settings | view, create, edit, delete | ✅ | ✅ | ❌ | ❌ | `app/api/workspaces/[id]/notifications/route.ts:21`, `notifications/[endpointId]/route.ts:18,32` (`manage_workspace`) |
| Audit log | view (own workspace only) | ✅ | ✅ | ✅ | ✅ | `app/api/admin/audit-logs/route.ts:16` (`canReadWorkspace`; query scoped to the workspace at `:39-41`) |
| Analytics, AI insight, optimizer views | view | ✅ | ✅ | ✅ | ✅ | `app/api/insight/revenue`, `app/api/ai/invoice-insight`, `app/api/opt/experiments`, `opt/auto/logs` (`canReadWorkspace`) |
| Optimizer actions | start, record metrics, choose winner, apply schedule, revert | ✅ | ✅ | ✅ | ❌ | `app/api/opt/*` POST routes (`canWriteWorkspace`) |

¹ Owner memberships cannot be changed or removed by anyone, and `OWNER` cannot be assigned (see "Ownership rules").
² An `ADMIN` can invite `MEMBER` or `VIEWER` only.

> **Open decision:** any member, including VIEWER, can read the workspace audit log (app/api/admin/audit-logs/route.ts:16).

## Ownership rules

These are enforced in `app/api/workspaces/[id]/members/[membershipId]/route.ts` and `app/api/workspaces/[id]/invitations/route.ts`:

- **`OWNER` cannot be granted.** The role schemas for invitations (`invitations/route.ts:16`) and role changes (`members/[membershipId]/route.ts:11`) accept only `ADMIN`, `MEMBER` and `VIEWER`. You become an owner only by creating a workspace or through signup provisioning.
- **Owner memberships are immutable through the API.** A role change on an `OWNER` membership returns `403` for any caller, including another owner (`members/[membershipId]/route.ts:34`). Removing an `OWNER` returns `409` (`:53`). Since owners can be neither demoted nor removed, a workspace can never lose its last owner. Ownership transfer is not implemented.
- **An `ADMIN` cannot grant `ADMIN`.** It cannot invite an `ADMIN` (`invitations/route.ts:66`) or promote a member to `ADMIN` (`members/[membershipId]/route.ts:34`). An `ADMIN` can demote or remove another `ADMIN`.

## Platform administrators

Platform admin is decided by `isPlatformAdmin(session)` in `lib/devtools/access.ts`: `session.user.id` (the NextAuth JWT `sub`, i.e. `"User"."id"`) must appear in `ADMIN_USER_IDS` (comma-separated). Pages and layouts use `requirePlatformAdminPage()` and server actions use `assertPlatformAdminAction()` from `lib/devtools/require-platform-admin.ts`; API routes call `isPlatformAdmin` directly. Only `next dev` (`NODE_ENV=development`) bypasses the allowlist.

Email is not an identity: credentials registration does not verify email ownership, so `ADMIN_EMAILS` / `NEXT_PUBLIC_ADMIN_EMAILS` are deprecated, ignored, and produce a startup warning when set.

Operator migration. Do NOT look your id up by email (`SELECT id FROM "User" WHERE email = ...`): if the admin address was ever unclaimed, that query can return an account an attacker registered. Take the id from your own authenticated session instead. Safe deploy order:

1. Sign in as yourself on the current deployment and open `GET /api/auth/session`; copy `user.id`.
2. Set `ADMIN_USER_IDS=<id>[,<id>...]` in **Production and Preview** (every environment that serves real users).
3. Merge and deploy this change.
4. Verify as an admin that `/devtools/perf` loads, and as a non-admin that it redirects to `/app`.
5. Remove `ADMIN_EMAILS` and `NEXT_PUBLIC_ADMIN_EMAILS`, redeploy, and confirm the startup log has no `[security] ADMIN_...` warning.

Incident review for the exposure window (the time `ADMIN_EMAILS` was set and honoured):

- Compare `"User"` rows whose email matches a former `ADMIN_EMAILS` entry with the real admin's own account. A matching row the real admin did not create (check `createdAt`, and whether the owner can log in with it) means the address was squatted.
- Review `FeatureFlag` rows (`updatedAt`/`createdAt`) for changes the team did not make.
- Review devtools activity in the window: `AuditLog` rows for the suspect user ids, `OptimizationLog` status/`actor` changes, `ExplanationLog` rows created by the suspect user (including its email-shaped `actor` values), and `UptimeCheck` rows triggered manually.
- Rotate anything an admin route could have exposed (for example `FEDERATION_TOKEN_SECRET`) if a squatted account is found.

## Authorization contract

Route handlers must resolve the active workspace from the authenticated user and re-read membership from PostgreSQL. `organizationId` supplied by a browser is a selector at most; it is never an authorization grant. A missing membership returns `403`, and resources outside the active workspace return `404` to avoid leaking identifiers.

Mutating operations use the central permission matrix (see [Resource × action matrix](#resource--action-matrix)). Owner memberships cannot be demoted or removed by anyone, and administrators cannot grant `ADMIN` (see [Ownership rules](#ownership-rules)). Audit entries include the workspace identifier and acting user.

## Implemented API surface

- `/api/workspaces` lists memberships and creates a workspace; `/api/workspaces/switch` changes the active workspace after membership validation.
- `/api/workspaces/[id]/members` and `/members/[membershipId]` expose member listing, role changes, and removal with owner safeguards.
- `/api/workspaces/[id]/invitations` issues redacted invitation records and returns the raw one-time token only to the trusted creator; `/api/workspace-invitations/[token]/accept` claims it atomically.
- `/api/workspaces/[id]/notifications` stores encrypted Slack endpoint configuration without returning webhook credentials.
- `/api/workspaces/[id]/reminder-rules` (GET, POST) and `/reminder-rules/[ruleId]` (PATCH, DELETE) manage reminder policies, while `/api/cron/reminders` materializes unique due occurrences every five minutes.
- `/api/workspaces/[id]/api-keys` (GET, POST) and `/api-keys/[keyId]` (GET, PATCH, DELETE) manage customer API credentials. The raw secret is returned once, at creation. See [API.md](./API.md).
- `/api/workspaces/[id]/notifications/[endpointId]` (PATCH, DELETE) updates or removes a notification endpoint.
- `/api/admin/audit-logs` (GET) returns the active workspace's audit entries, filtered by `action`, `entity`, `userId` and date range. Despite the `/admin/` path it is workspace-scoped, not platform-admin. A `tenantId` other than the active workspace returns `403`.
- `/api/cron/reminder-delivery` (GET, POST; `CRON_SECRET` bearer) dispatches due reminder deliveries.

The reminder cron materializes retry-safe occurrences, while the authenticated
delivery dispatcher claims per-channel rows and sends through Resend or the
encrypted Slack endpoint. Delivery rows expose `PENDING`, `PROCESSING`,
`RETRY`, `SENT`, `FAILED`, and `SKIPPED` states with bounded retries and audit
telemetry. Provider sandbox certification remains a release gate; a materialized
occurrence must never be treated as delivered until its channel row is `SENT`.

## Migration sequence

Set `WORKSPACE_AUTH_MODE=compat` during the additive rollout. After the
staging backfill and orphan checks pass, set `WORKSPACE_AUTH_MODE=enforce`;
missing membership/delegates then fail closed instead of falling back to
user-owned rows. Keep the compatibility mode available for rollback until all
business routes have been certified.

Concurrency: personal-workspace provisioning (signup, the compat lazy path, the backfill script) runs in a transaction that first takes a `FOR NO KEY UPDATE` lock on the user row, so concurrent first requests serialise and only one workspace is created. There is still no database constraint identifying a "personal" workspace; deliberate extra workspaces (`POST /api/workspaces`, invitations) are separate and unaffected.

1. Expand the schema with nullable organization references, `Organization`, `Membership`, and `User.activeOrganizationId`.
2. Create one personal organization and `OWNER` membership per existing user. The foundation migration does this once for users that exist when it runs; it is not a general-purpose backfill (see below).
3. Backfill invoices, clients, and invoice templates from `userId` to the personal organization.
4. Verify there are no orphaned rows, duplicate invoice numbers within a workspace, or clients violating workspace uniqueness.
5. Deploy application code that reads workspace scope while retaining the legacy `userId` fallback during the compatibility window.
6. Deploy team-operation tables for invitations, encrypted Slack endpoint configuration, reminder rules, and unique reminder occurrences.
7. After a successful staging rehearsal, enforce non-null organization ownership and deploy the contract migration.

Rollback is performed by restoring the previous application version and leaving the additive organization columns in place; destructive column removal is deferred until all downstream consumers have migrated.

### Backfilling stranded users

Users who registered under `enforce` before signup provisioning existed (or any user with no membership) are backfilled with the script, not with SQL:

```bash
# Who is affected (should be empty once backfilled and for all new signups):
psql "$DATABASE_URL" -c 'SELECT u."id", u."email" FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = u."id")'

DATABASE_URL=postgresql://... npm run db:backfill-workspaces            # dry run (default): prints target host, count and ids
DATABASE_URL=postgresql://... npm run db:backfill-workspaces -- --apply # provisions, one transaction per user
```

`DATABASE_URL` must be exported explicitly (a value that exists only in `.env` is not used) and the target host is printed before anything is written. The script only selects users with no membership and provisions each through the same code as signup, so it is safe to re-run; a second run changes nothing.

Do NOT re-run the personal-workspace block of `prisma/migrations/20260813120000_workspace_rbac_foundation/migration.sql` to backfill. It is keyed on a deterministic `personal_<md5>` id for every user without checking for existing memberships, so on a database with application-provisioned workspaces (cuid ids) it would give those users a second organization and a second `OWNER` membership, and the later `UPDATE ... FROM "Membership"` joins could move rows into an unintended workspace.

## Required test cases

- Registration and first Google sign-in create the user, personal organization, `OWNER` membership, and `activeOrganizationId` atomically in both auth modes; a duplicate email returns `409` and creates no workspace.
- Personal-workspace backfill (`npm run db:backfill-workspaces`) selects only users without a membership, is a no-op on a second run, and writes nothing in dry-run mode.
- Concurrent provisioning for the same user yields exactly one personal workspace.
- A user can read and mutate resources in a workspace where they are a member, but cannot access another workspace by changing a URL or request body.
- `VIEWER` mutations, any change to or removal of an `OWNER` membership, and `ADMIN` granting `ADMIN` are rejected.
- Switching workspaces updates the active selector but does not bypass membership checks.
- Invitation tokens are only stored as digests, expire after seven days, and can be claimed once.
- Slack credentials cannot be stored or read when `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` is absent or invalid.
- Reminder retries reuse the same occurrence key and never create duplicate rows.
