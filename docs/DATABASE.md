# InvoSmart Database Documentation

This document outlines the database architecture, environment configuration, migration workflows, schema models, and utility CLI commands for the InvoSmart application.

---

## 1. Architecture Overview

InvoSmart uses **PostgreSQL** as its primary relational database management system (RDBMS) for both development and production environments, interfaced via **Prisma ORM** (`@prisma/client`).

Key architectural highlights:
- **Unified Engine**: PostgreSQL is used consistently across local development and production environments, eliminating dialect mismatches.
- **Declarative Schema**: Database structure is defined in `prisma/schema.prisma` using `provider = "postgresql"` and `url = env("DATABASE_URL")`.
- **Versioned Migrations**: Declarative schema changes are tracked and deployed using Prisma's versioned migration system (`prisma/migrations/`).
- **Rich Data Types**: Native PostgreSQL features are utilized, including `JSONB` for flexible metadata storage (e.g. audit details, AI payloads), PostgreSQL Enum types, precision timestamps, and composite indexing.

---

## 2. Environment Configuration

The application expects a `DATABASE_URL` environment variable configured with a PostgreSQL connection string.

### Connection String Format
```env
DATABASE_URL="postgresql://<USER>:<PASSWORD>@<HOST>:<PORT>/<DATABASE_NAME>?schema=<SCHEMA>"
```

### Development Environment Configuration
For local development, copy `.env.example` to `.env` or export `DATABASE_URL`:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invosmart?schema=public"
```

### Production Environment Configuration
In production environments (e.g. cloud PostgreSQL providers like AWS RDS, Supabase, Neon, or Neon/CockroachDB), ensure connection pooling parameters (e.g. `pgbouncer=true` or connection pool limits) and SSL modes are appropriately specified if required:
```env
DATABASE_URL="postgresql://invosmart_prod_user:secure_password@db.example.com:5432/invosmart_prod?schema=public&sslmode=require"
```

### Docker Local PostgreSQL Setup (Optional)
To spin up a local PostgreSQL instance quickly using Docker:
```bash
docker run --name invosmart-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=invosmart \
  -p 5432:5432 \
  -d postgres:15-alpine
```

---

## 3. Migration Workflow

InvoSmart uses Prisma's migration workflow to manage schema evolution safely.

### 3.1 Local Migration Creation (`npx prisma migrate dev`)
When modifying `prisma/schema.prisma` during development:
```bash
npx prisma migrate dev --name <descriptive_migration_name>
```
This command:
1. Validates the schema changes against `prisma/schema.prisma`.
2. Generates a new SQL migration file under `prisma/migrations/<timestamp>_<migration_name>/`.
3. Applies the SQL migration to your local PostgreSQL database.
4. Regenerates the `@prisma/client` TypeScript types.

### 3.2 Production Migration Execution (`npx prisma migrate deploy`)
Apply pending migrations to a staging or production database with:
```bash
npx prisma migrate deploy
```
This command applies any pending versioned migrations from `prisma/migrations/` to the target database without modifying schema files or prompting for input.

In production the `deploy` job in `.github/workflows/release.yml` runs this command automatically, after `prisma generate` and before `npm run build` and `vercel deploy --prod`, with `DATABASE_URL` taken from the `PRODUCTION_DATABASE_URL` secret of the `production` GitHub environment (created by the repository owner). That secret must be the **direct (non-pooled) connection string**: this schema declares no `directUrl`, so the URL is used for DDL, and a PgBouncer/transaction-pooled URL breaks the advisory lock `migrate deploy` takes. Staging migrations are still applied by hand, and `npm run release:certify` only runs `prisma migrate status`. Release order, the manual fallback and the environment setup are in [DEPLOYMENT.md](./DEPLOYMENT.md#database-migrations).

### 3.3 Checking Migration Status (`npx prisma migrate status`)
To verify whether the database schema is up to date with existing migrations:
```bash
npx prisma migrate status
```

### 3.4 Initial Baseline Migration
The baseline PostgreSQL migration is located at:
`prisma/migrations/20260811000000_init_postgresql_schema/migration.sql`

This migration creates the original 18 tables and 8 PostgreSQL enum types (the Phase 1 core, AI and audit models), with their indexes and foreign keys. Later migrations add the remaining 16 tables and 4 enums; `prisma/schema.prisma` currently defines **34 models and 12 enums**.

| Migration | Tables added | Enums added |
|---|---|---|
| `20260811000000_init_postgresql_schema` | 18 | 8 |
| `20260811171520_add_m0_phase2_models` | 3 | 0 |
| `20260812170000_payment_idempotency` | 0 (constraints/indexes) | 0 |
| `20260812173000_payment_attempts_events` | 2 | 2 |
| `20260813120000_workspace_rbac_foundation` | 3 | 1 |
| `20260813130000_team_operations` | 4 | 0 |
| `20260814100000_invoice_reminder_deliveries` | 1 | 1 |
| `20260814110000_api_keys` | 1 | 0 |
| `20260827070000_add_performance_indexes` | 0 (indexes) | 0 |
| `20261016170000_federation_inbound_events` | 1 | 0 |
| `20261016180000_cron_lease` | 1 | 0 |

### 3.5 Payment Lifecycle Migration

The additive payment lifecycle migration is located at:
`prisma/migrations/20260812173000_payment_attempts_events/migration.sql`

Apply it with `npx prisma migrate deploy` before enabling provider webhooks in a staging or production environment. It is safe for existing invoices and settled `Payment` rows: `PaymentAttempt` is nullable on legacy records, while new checkout and webhook flows persist attempts and events.

### 3.6 Customer API Key Migration

The additive API credential migration is located at:
`prisma/migrations/20260814110000_api_keys/migration.sql`

`ApiKey` records are workspace-scoped and persist only a SHA-256 digest of the
private credential. Prefix lookup, scopes, expiry, revocation, and last-use
timestamps support the versioned customer API without exposing raw secrets.

---

## 4. Data Model

`prisma/schema.prisma` is the source of truth for fields, types and indexes. This section explains what each model is for, how models relate, and **who owns each row**. Ownership is what every authorization check in [WORKSPACE_RBAC.md](./WORKSPACE_RBAC.md) is built on.

### 4.1 Ownership rules

| Ownership | Meaning | Models |
|---|---|---|
| **Workspace (required)** | `organizationId` is non-null with a cascading FK to `Organization`. Access is decided by `Membership`. | `Membership`, `WorkspaceInvitation`, `WorkspaceNotificationEndpoint`, `InvoiceReminderRule`, `InvoiceReminderOccurrence`, `ApiKey` |
| **Workspace with legacy user fallback** | `organizationId` is **nullable** (`onDelete: SetNull`) and `userId` is required. While `WORKSPACE_AUTH_MODE=compat`, rows with no organization are scoped to their `userId` (the `LEGACY` role in `lib/workspaces.ts`). Under `enforce`, only membership grants access. | `Invoice`, `Client`, `InvoiceTemplate` |
| **Inherited from parent** | No ownership column of their own. Access follows the parent row, and they are deleted with it (`onDelete: Cascade`). | `Payment`, `PaymentAttempt`, `PaymentEvent` (via `Invoice`); `Receipt`, `ReceiptAuditLog` (via `Payment`); `InvoiceReminderDelivery` (via `InvoiceReminderOccurrence`) |
| **Tenant-tagged, no FK** | A free-form tenant string or nullable `organizationId` without a foreign key. Readers must filter on it. | `AuditLog.tenantId`, `ContentExperiment`, `AiAutoAction`, `GlobalContentSignal`, `FederationMetrics.tenantId`, `FederationInboundEvent.tenantId` |
| **Global / platform** | Not tenant data. Only platform admins can read or change it (see [WORKSPACE_RBAC.md](./WORKSPACE_RBAC.md#platform-administrators)). | `User` (identity), `FeatureFlag`, `UptimeCheck`, `CronLease`, `AutonomyLoopState`, `OptimizationLog`, `ExplanationLog`, `LearningProfile`, `AgentEventLog`, `AgentPriority`, `RecoveryLog` |

Money columns (`subtotal`, `tax`, `total`, `amount`, `paidAmount`, `refundedAmount`) are integers in the currency's major unit (IDR has no minor unit). The currency is stored next to them, and the default is `IDR`.

### 4.2 Core business ERD

```mermaid
erDiagram
    User ||--o{ Membership : "has"
    Organization ||--o{ Membership : "has"
    Organization ||--o{ WorkspaceInvitation : "issues"
    User ||--o{ WorkspaceInvitation : "invites (invitedById)"
    Organization ||--o{ ApiKey : "owns"
    User ||--o{ ApiKey : "creates (createdById)"
    Organization ||--o{ Client : "owns (nullable)"
    User ||--o{ Client : "created by"
    Organization ||--o{ Invoice : "owns (nullable)"
    User ||--o{ Invoice : "created by"
    Client |o--o{ Invoice : "billed (clientId)"
    Organization ||--o{ InvoiceTemplate : "owns (nullable)"
    Client |o--o{ InvoiceTemplate : "default client"
    Invoice ||--o{ PaymentAttempt : "checkout"
    PaymentAttempt ||--o{ PaymentEvent : "webhook history"
    Invoice ||--o{ Payment : "ledger"
    PaymentAttempt |o--o{ Payment : "settles"
    Payment ||--o{ Receipt : "proof"
    Organization ||--o{ InvoiceReminderRule : "defines"
    InvoiceReminderRule ||--o{ InvoiceReminderOccurrence : "materializes"
    Invoice ||--o{ InvoiceReminderOccurrence : "reminded"
    InvoiceReminderOccurrence ||--o{ InvoiceReminderDelivery : "per channel"
    User |o--o{ AuditLog : "actor (SetNull)"
```

`AuditLog.tenantId` holds an `Organization.id` but has no foreign key, so it is not drawn as a relation.

### 4.3 Identity & tenancy

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `User` | Account identity: credentials (bcrypt `password`, null for Google-only accounts), branding and theme preferences, `locale`, `defaultCurrency`. `activeOrganizationId` is only a hint and is always rechecked against `Membership`. | Has memberships, invoices, clients, templates, audit logs, sent invitations, created API keys. `email` is unique. | Global identity | — |
| `Organization` | A workspace. Every signup gets a personal one (`lib/workspace-provisioning.ts`). Holds workspace branding and currency. | Owns members, invoices, clients, templates, invitations, notification endpoints, reminder rules, API keys. | Root of a tenant | — |
| `Membership` | The user ↔ workspace link that carries the role. It is the only source of authorization. | `@@unique([organizationId, userId])`. Cascades with both sides. | Workspace | `WorkspaceRole`: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` |
| `WorkspaceInvitation` | A one-time invitation that expires after seven days. Only the SHA-256 `tokenHash` is stored. | `invitedById` → `User`. `tokenHash` is unique. | Workspace | `WorkspaceRole` (only `ADMIN`/`MEMBER`/`VIEWER` can be invited). State is implied by `acceptedAt` / `revokedAt` / `expiresAt`. |
| `WorkspaceNotificationEndpoint` | Per-workspace provider settings (currently Slack). The webhook URL is stored encrypted in `secretCiphertext` with `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY`. | `@@unique([organizationId, type])` | Workspace | `enabled` flag |

### 4.4 Invoicing & clients

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `Invoice` | An invoice. `client` is a denormalised client name, `items` holds line items as JSON, totals are integers. `number` is `INV-YYYYMM-NNN`, generated per workspace (`generateInvoiceNumber` in `lib/schemas.ts`). | `@@unique([organizationId, number])`. Optional `clientId` → `Client`. Has payment attempts, payments and reminder occurrences. | Workspace + legacy `userId` | `InvoiceStatus`: `DRAFT`, `SENT`, `PAID`, `UNPAID`, `OVERDUE` |
| `Client` | A customer record: contact details, tax ID, currency. | `@@unique([userId, email])` and `@@unique([organizationId, email])`. Has invoices and templates. | Workspace + legacy `userId` | — |
| `InvoiceTemplate` | A reusable invoice body, used by `POST /api/invoices/templates/[id]/instantiate`. | Optional `clientId` → `Client` (`SetNull`). | Workspace + legacy `userId` | — |

How invoice status changes:
- A gateway settlement sets `PAID` with a conditional update (`status <> 'PAID'`, `claimInvoiceForSettlement` in `lib/payments/settlement.ts`).
- A full refund sets it back to `UNPAID` and clears `paidAt` (`app/api/payments/stripe/webhook/route.ts:360`, `app/api/payments/midtrans/notification/route.ts:343`).
- `SENT` and `UNPAID` invoices become `OVERDUE` the first time they are read after `dueAt` passes. This is an atomic update that writes an `INVOICE_AUTO_OVERDUE` audit entry (`lib/invoices/get-invoice.ts:27-107`).
- Other changes come from user edits through `PUT /api/invoices/[id]`.

### 4.5 Payments

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `PaymentAttempt` | One checkout at a provider (`midtrans` or `stripe`). It stores an immutable amount/currency, stable provider IDs and an idempotency key. It expires after 30 minutes (`PAYMENT_ATTEMPT_TTL_MINUTES`, `lib/payments/lifecycle.ts`). `metadata` holds the latest provider payload plus server-written `duplicateSettlement` / `reviewRequired` markers. | `@@unique([provider, idempotencyKey])`, `@@unique([provider, providerOrderId])` | Via `Invoice` | `PaymentAttemptStatus`: `PENDING`, `AUTHORIZED`, `SETTLED`, `EXPIRED`, `CANCELLED`, `FAILED`, `REFUNDED` |
| `PaymentEvent` | Append-only history of provider webhooks. Used to deduplicate replays and to audit events that arrive out of order. | `@@unique([provider, providerEventId])` | Via `PaymentAttempt` | `PaymentEventType` (same values as the attempt status) |
| `Payment` | The settled-money ledger: `paidAmount`, cumulative `refundedAmount`, gateway IDs. Rows without an `attemptId` are legacy or manual payments. | `@@unique([gatewayProvider, gatewayPaymentId])`. Optional `attemptId` (`SetNull`). Has receipts. | Via `Invoice` | `gatewayStatus` (provider string) |

### 4.6 Delivery & reminders

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `InvoiceReminderRule` | A reminder policy: `offsetDays` relative to the due date (−365…365) and `channels` (`EMAIL`, `SLACK`). | Has occurrences. | Workspace | `enabled` flag |
| `InvoiceReminderOccurrence` | One scheduled reminder for one invoice and rule. `/api/cron/reminders` creates it, and the unique `occurrenceKey` keeps cron retries idempotent. `/api/cron/retention` deletes `SENT`/`FAILED`/`SKIPPED` occurrences scheduled more than 12 months ago, with their deliveries (cascade); pending ones are kept. | `@@unique(occurrenceKey)`. Has one delivery per channel. | Workspace | `status` (string), rolled up from its deliveries: `PENDING`, `RETRY`, `SENT`, `FAILED`, `SKIPPED` |
| `InvoiceReminderDelivery` | One delivery attempt row per channel, processed by `/api/cron/reminder-delivery`. | `@@unique([occurrenceId, channel])` | Via occurrence | `InvoiceReminderDeliveryStatus`: `PENDING`, `PROCESSING`, `RETRY`, `SENT`, `FAILED`, `SKIPPED` |

Invoice email delivery (`POST /api/invoices/[id]/send-email`) has no table of its own. Attempts are appended to `Invoice.emailLog` (JSON) and `emailedAt` is set. A send is tried at most 4 times (`MAX_EMAIL_ATTEMPTS`, `lib/invoice-delivery.ts:21-22`).

### 4.7 Receipts

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `Receipt` | Proof of payment for a `Payment`. `verifyToken` backs the public `/receipts/[id]/verify` page. Stores layout and stamp options. | `receiptNo` is unique. Has an audit trail. | Via `Payment` | `ReceiptPosition`: `bottom_left`, `bottom_right`, `center` |
| `ReceiptAuditLog` | Receipt events (creation, verification) with actor and metadata. | → `Receipt` (cascade) | Via `Receipt` | `action` (string) |

### 4.8 Customer API

| Model | Purpose | Key relationships / constraints | Ownership | Status / enum |
|---|---|---|---|---|
| `ApiKey` | A credential for `/api/v1`. Only the short public `prefix` and a SHA-256 `secretHash` are stored. Scopes come from `invoices:read`, `invoices:write`, `clients:read` and `clients:write` (`lib/api-keys.ts`). New keys default to read-only. | `prefix` is unique. `createdById` → `User`. | Workspace | Active / expired / revoked, implied by `expiresAt` and `revokedAt` |

Idempotency keys and rate-limit windows for `/api/v1` are kept in Upstash Redis, not PostgreSQL (see [API.md](./API.md)).

### 4.9 Platform & admin

| Model | Purpose | Ownership |
|---|---|---|
| `AuditLog` | The general audit trail: invoice, auth, workspace, payment, reminder and AI auto-action events. Columns: `tenantId`, `userId`, `action`, `entity`, `entityId`, `details` (JSONB), `ipAddress`. Written by `logAuditEvent()` in `lib/audit/auditLogger.ts`. Purged by `/api/cron/retention`: rows are deleted after 12 months and `ipAddress` is set to `null` after 90 days ([SECURITY.md](../SECURITY.md#retention-and-deletion)). | Tenant-tagged (`tenantId`). Users are attached with `SetNull` on delete. |
| `FeatureFlag` | Runtime toggles. `targetTenants` / `targetUsers` are JSON allowlists (`lib/feature-flags.ts`). | Global |
| `UptimeCheck` | Results from `/api/cron/uptime`: status code, latency, `UP`/`DOWN`. | Global |
| `CronLease` | One row per named scheduled job (`name` is the key, e.g. `retention`). A cron claims it with a conditional update that sets `claimedUntil` in the future only when it is null or past, so an overlapping invocation skips; it clears `claimedUntil` and sets `lastRunAt` when done. A crashed run blocks the next one only until `claimedUntil` passes. | Global |

### 4.10 AI agents

All of these are global platform telemetry, with no tenant column.

| Model | Purpose | Status / enum |
|---|---|---|
| `OptimizationLog` | Optimizer recommendations per route, with confidence, evaluation results and the policy verdict. | `OptimizationStatus`: `PENDING`, `APPLIED`, `REJECTED`. `PolicyStatus`: `ALLOWED`, `REVIEW`, `BLOCKED` |
| `ExplanationLog` | The governance explanation for a recommendation: why, the data it was based on, trust score. | `PolicyStatus` |
| `LearningProfile` | Learning-agent state per route (success rate, confidence weight, last p95 metrics). Keyed by `route`. | — |
| `AgentEventLog` | Persisted MAP events (`traceId`, type, source/target agent, priority, payload). The fallback for the Redis stream. | `eventType` string (see `lib/ai/protocol.ts`) |
| `AgentPriority` | The current dynamic weight per agent. | — |
| `RecoveryLog` | Rollback and re-evaluation actions by the recovery agent, with trust before/after. | — |
| `AutonomyLoopState` | Single row (`id = "singleton"`) driving the autonomy loop from the `/api/cron/autonomy` cron ([ADR 016](./adr/016-autonomy-loop-cron-scheduling.md)): `paused` (defaults to `true`; a platform admin resumes it in DevTools), `nextRunAt`, `lastRunAt`, the scaler state carried between serverless invocations (`lastIntervalMs`, `lastConcurrency`, `lastTelemetry`), `lastSummary`, `lastResult` (scaling and recovery), and a `claimedUntil` lease so overlapping cron invocations skip. | — |

### 4.11 Content optimization

| Model | Purpose | Ownership | Status / enum |
|---|---|---|---|
| `ContentExperiment` | An experiment on one content axis, with an optional winning variant. | Nullable `organizationId` (no FK) | `ExperimentAxis`: `HOOK`, `CAPTION`, `CTA`, `SCHEDULE`. `ExperimentStatus`: `running`, `paused`, `stopped`, `completed` |
| `ContentVariant` | One variant: payload, AI explanation, confidence. `@@unique([experimentId, variantKey])`. | Via experiment | — |
| `VariantMetric` | Impression, click, conversion and dwell counters for a variant. | Via variant | — |
| `AiAutoAction` | Actions taken automatically by approval gates (`lib/ai/approval-gates.ts`). | Nullable `organizationId` (no FK) | `AutoActionType`: `AUTOPUBLISH`, `SCHEDULE_UPDATE`, `AUTO_REVERT`, `AUTO_CTA_TUNE`. `AutoActionStatus`: `applied`, `reverted`, `failed` |
| `GlobalContentSignal` | Aggregated signals per axis and time window, for global learning. `@@unique([organizationId, axis, window])`. | Nullable `organizationId` (no FK) | `ExperimentAxis` |

### 4.12 Federation

| Model | Purpose | Ownership |
|---|---|---|
| `FederationMetrics` | Aggregate trust statistics and agent priorities per federation cycle. `@@unique([cycleId, tenantId])`. See the federation docs under `docs/ai/`. | Tenant-tagged (`tenantId` string) |
| `FederationInboundEvent` | One row per event received on `POST /api/federation/events` that passed signature verification and the 5-minute freshness window: `eventId`, sender `tenantId`, `type`, `signatureAlgorithm`, `eventTimestamp`, `receivedAt`, and `accepted` (`false` for echoes of this instance's own events). `signatureHash` (SHA-256 of the signature) is `@unique` and is the replay key, because the signature does not cover the event `id`. No retention purge yet; the table grows by one row per verified event. | Tenant-tagged (`tenantId` string, the sender) |

### 4.13 Lifecycles

Only the transitions the code enforces are listed here.

**`PaymentAttemptStatus`.** `decidePaymentTransition()` in `lib/payments/lifecycle.ts` controls this. Webhooks run under a row lock on the attempt (`lockPaymentAttempt`, `lib/payments/settlement.ts`).

| From | Allowed to |
|---|---|
| `PENDING` | `AUTHORIZED`, `SETTLED`, `EXPIRED`, `CANCELLED`, `FAILED` |
| `AUTHORIZED` | `SETTLED`, `EXPIRED`, `CANCELLED`, `FAILED` |
| `SETTLED` | `REFUNDED` |
| `EXPIRED`, `CANCELLED`, `FAILED`, `REFUNDED` | none (terminal) |

- The same status arriving again is treated as a `duplicate`.
- A status of lower rank arriving after a later one is `ignore`d (out of order but harmless). Rank: `PENDING`/`EXPIRED`/`CANCELLED`/`FAILED` = 0, `AUTHORIZED` = 1, `SETTLED` = 2, `REFUNDED` = 3.
- Any other change is `invalid`. Examples: `EXPIRED → SETTLED`, `FAILED → AUTHORIZED`.
- Partial refunds keep the status at `REFUNDED` and increase `Payment.refundedAmount` up to `paidAmount` (`calculateRefundedAmount`).
- A refund that arrives before settlement is rejected with `409` on Midtrans (`app/api/payments/midtrans/notification/route.ts:323`).
- A provider settlement for an invoice that is already paid leaves the attempt `SETTLED`. It creates no `Payment` and records a `duplicateSettlement` marker so the money can be refunded.
- A gateway payment on an invoice that was marked paid by hand records the `Payment` with a `reviewRequired` marker.

**`InvoiceReminderDeliveryStatus`.** Controlled by `lib/team/reminder-delivery.ts`. Every update is a compare-and-set on the expected current status.

| From | To | Trigger |
|---|---|---|
| `PENDING`, `RETRY` | `PROCESSING` | Claimed by a worker when `nextAttemptAt` is due. Increments `attempts` and sets `claimedAt`. |
| `PROCESSING` | `SENT` | The provider accepted the message. |
| `PROCESSING` | `RETRY` | Retryable failure and `attempts < 5`. Backoff is 5 min, 15 min, 1 h, then 6 h (`REMINDER_RETRY_DELAYS_MS`). |
| `PROCESSING` | `FAILED` | Non-retryable failure, or the retry limit (`MAX_REMINDER_DELIVERY_ATTEMPTS = 5`) is reached. |
| `PROCESSING` | `SKIPPED` | Invalid channel, the provider reported a skip, or the invoice became paid. |
| `PROCESSING` (claim older than 10 min) | `RETRY`, or `FAILED` if attempts are used up | Stale lease recovery (`REMINDER_DELIVERY_LEASE_MS`). |
| `PENDING`, `RETRY` | `FAILED` | Found with `attempts >= 5` when it would be claimed. |
| `PENDING`, `RETRY`, `PROCESSING` | `SKIPPED` | The invoice is paid. Reminders are suppressed with `errorCode: paid_invoice`. |

`SENT`, `FAILED` and `SKIPPED` are terminal: the dispatcher never claims them again.

An occurrence's status is rolled up from its deliveries:
- `PENDING`/`RETRY` while any delivery is still active
- otherwise `FAILED` if any delivery failed
- otherwise `SENT` if any delivery was sent
- otherwise `SKIPPED`

A materialized occurrence counts as delivered only once one of its channel rows is `SENT`.

---

## 5. Useful Prisma CLI Commands

| Command | Description |
|---|---|
| `npx prisma validate` | Validates the syntax and structural integrity of `prisma/schema.prisma`. |
| `npx prisma generate` | Generates updated `@prisma/client` TypeScript types based on `prisma/schema.prisma`. |
| `npx prisma migrate dev` | Creates and applies a new migration in local development. |
| `npx prisma migrate deploy` | Applies pending migrations to a staging/production database (the production `deploy` job runs it automatically; staging is manual; see [DEPLOYMENT.md](./DEPLOYMENT.md)). |
| `npx prisma migrate status` | Checks pending migrations against the connected database. |
| `npx prisma studio` | Launches an interactive web UI (`http://localhost:5555`) to view and edit database records. |
| `npm run db:seed` | Seeds the database with default initial data using `prisma/seed.ts`. |

Workspace/team migrations are additive and should be rehearsed on staging before enforcing non-null organization ownership:

- `20260813120000_workspace_rbac_foundation` provisions personal workspaces, memberships, and backfills business rows.
- `20260813130000_team_operations` adds invitations, encrypted notification endpoint metadata, reminder rules, and idempotent occurrences.
- `20260814110000_api_keys` adds workspace-scoped credentials for the `/api/v1` invoice/client API.

---

## 6. Development Best Practices

1. **Do Not Edit Applied Migrations**: Once a migration SQL file in `prisma/migrations/` is committed, do not modify it directly. Create a new migration instead.
2. **Always Use Environment Variables**: Never hardcode connection credentials in source files. Use `process.env.DATABASE_URL`.
3. **Validate Schema Before Commit**: Run `npx prisma validate` to confirm schema validity before submitting pull requests.
4. **Mock Prisma in Unit Tests**: Unit tests in `lib/__tests__/` use isolated mocks (`vi.mock('@/lib/db')`) so tests can execute without requiring an active database server.
