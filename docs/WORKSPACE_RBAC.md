# Workspace and RBAC Runbook

## Model

Each account receives a personal workspace. A user may belong to multiple workspaces but has one active workspace at a time. Workspace membership is persisted in the database and is the source of truth for authorization.

The initial roles are:

| Role | Capabilities |
| --- | --- |
| `OWNER` | All business operations, billing/settings, member administration, ownership transfer, and workspace deletion |
| `ADMIN` | Workspace settings, invitations, member management below owner, and all business operations |
| `MEMBER` | Create and manage invoices, clients, templates, delivery, payments, exports, and analytics |
| `VIEWER` | Read-only invoices, clients, templates, analytics, PDFs, and exports |

Signup provisions that workspace. Credentials registration (`/api/auth/register`) and first-time Google sign-in create the `User`, the personal `Organization`, the `OWNER` `Membership` and `User.activeOrganizationId` in a single transaction, in both `compat` and `enforce` modes (`createUserWithPersonalWorkspace` in `lib/workspace-provisioning.ts`); if the workspace cannot be created the user is not created either. Provisioning is idempotent and race-safe: it takes a `FOR NO KEY UPDATE` row lock on the user and a user who already has any membership is never given a second personal workspace. Only new signups are provisioned automatically; an existing user with no membership is still denied (`403`) under `enforce` until they are backfilled (see [Backfilling stranded users](#backfilling-stranded-users)). Under `compat`, such a user is still provisioned lazily on their first workspace-bound request.

The platform administrator allowlist used by DevTools is separate from workspace administration; see [Platform administrators](#platform-administrators). Workspace `OWNER`/`ADMIN` never grants access to global resources (DevTools, global feature flags, uptime, cross-tenant audit logs).

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

Mutating operations use the central permission matrix. The last owner cannot be removed or demoted, and an administrator cannot change an owner. Audit entries include the workspace identifier and acting user.

## Implemented API surface

- `/api/workspaces` lists memberships and creates a workspace; `/api/workspaces/switch` changes the active workspace after membership validation.
- `/api/workspaces/[id]/members` and `/members/[membershipId]` expose member listing, role changes, and removal with owner safeguards.
- `/api/workspaces/[id]/invitations` issues redacted invitation records and returns the raw one-time token only to the trusted creator; `/api/workspace-invitations/[token]/accept` claims it atomically.
- `/api/workspaces/[id]/notifications` stores encrypted Slack endpoint configuration without returning webhook credentials.
- `/api/workspaces/[id]/reminder-rules` manages reminder policies, while `/api/cron/reminders` materializes unique due occurrences every five minutes.

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
- `VIEWER` mutations, `ADMIN` owner changes, and last-owner removal are rejected.
- Switching workspaces updates the active selector but does not bypass membership checks.
- Invitation tokens are only stored as digests, expire after seven days, and can be claimed once.
- Slack credentials cannot be stored or read when `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` is absent or invalid.
- Reminder retries reuse the same occurrence key and never create duplicate rows.
