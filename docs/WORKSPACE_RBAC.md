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

The platform administrator allowlist used by DevTools is separate from workspace administration.

## Authorization contract

Route handlers must resolve the active workspace from the authenticated user and re-read membership from PostgreSQL. `organizationId` supplied by a browser is a selector at most; it is never an authorization grant. A missing membership returns `403`, and resources outside the active workspace return `404` to avoid leaking identifiers.

Mutating operations use the central permission matrix. The last owner cannot be removed or demoted, and an administrator cannot change an owner. Audit entries include the workspace identifier and acting user.

## Implemented API surface

- `/api/workspaces` lists memberships and creates a workspace; `/api/workspaces/switch` changes the active workspace after membership validation.
- `/api/workspaces/[id]/members` and `/members/[membershipId]` expose member listing, role changes, and removal with owner safeguards.
- `/api/workspaces/[id]/invitations` issues redacted invitation records and returns the raw one-time token only to the trusted creator; `/api/workspace-invitations/[token]/accept` claims it atomically.
- `/api/workspaces/[id]/notifications` stores encrypted Slack endpoint configuration without returning webhook credentials.
- `/api/workspaces/[id]/reminder-rules` manages reminder policies, while `/api/cron/reminders` materializes unique due occurrences every five minutes.

The reminder cron currently materializes retry-safe occurrences. Email and Slack
delivery workers remain the next implementation step; until then, reminder
records must be monitored as pending work rather than treated as delivered.

## Migration sequence

1. Expand the schema with nullable organization references, `Organization`, `Membership`, and `User.activeOrganizationId`.
2. Create one personal organization and `OWNER` membership per existing user.
3. Backfill invoices, clients, and invoice templates from `userId` to the personal organization.
4. Verify there are no orphaned rows, duplicate invoice numbers within a workspace, or clients violating workspace uniqueness.
5. Deploy application code that reads workspace scope while retaining the legacy `userId` fallback during the compatibility window.
6. Deploy team-operation tables for invitations, encrypted Slack endpoint configuration, reminder rules, and unique reminder occurrences.
7. After a successful staging rehearsal, enforce non-null organization ownership and deploy the contract migration.

Rollback is performed by restoring the previous application version and leaving the additive organization columns in place; destructive column removal is deferred until all downstream consumers have migrated.

## Required test cases

- Personal-workspace backfill is repeatable and creates exactly one owner membership per user.
- A user can read and mutate resources in a workspace where they are a member, but cannot access another workspace by changing a URL or request body.
- `VIEWER` mutations, `ADMIN` owner changes, and last-owner removal are rejected.
- Switching workspaces updates the active selector but does not bypass membership checks.
- Invitation tokens are only stored as digests, expire after seven days, and can be claimed once.
- Slack credentials cannot be stored or read when `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` is absent or invalid.
- Reminder retries reuse the same occurrence key and never create duplicate rows.
