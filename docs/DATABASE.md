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
In CI/CD pipelines or production deployment scripts, run:
```bash
npx prisma migrate deploy
```
This command applies any pending versioned migrations from `prisma/migrations/` to the target production database without modifying schema files or prompting for input.

### 3.3 Checking Migration Status (`npx prisma migrate status`)
To verify whether the database schema is up to date with existing migrations:
```bash
npx prisma migrate status
```

### 3.4 Initial Baseline Migration
The baseline PostgreSQL migration is located at:
`prisma/migrations/20260811000000_init_postgresql_schema/migration.sql`

This migration creates all 18 tables, 8 PostgreSQL Enum types, composite indexes, foreign key relationships, and default timestamp definitions.

---

## 4. Database Schema Models Overview

The database schema is organized into four main functional domains:

### 4.1 Core Financial & User Domain
- **`User`**: User accounts, authentication credentials, and theme/branding preferences (`logoUrl`, `primaryColor`, `themePrimary`, `themeAccent`, `themeMode`).
- **`Invoice`**: Invoice records tracking customer details, total amounts, line items (JSON), status (`DRAFT`, `SENT`, `PAID`, `UNPAID`, `OVERDUE`), issue dates, and due dates.
- **`Payment`**: Payment transactions linked to invoices, tracking transaction IDs, payment methods, amounts, and statuses.
- **`Receipt`**: Dynamic receipt configurations including verification tokens, verification QR codes, layout positions (`bottom_left`, `bottom_right`, `center`), and design themes.
- **`ReceiptAuditLog`**: Financial verification audit log tracking token creation, verification events, and IP addresses.

### 4.2 AI Subsystem & Autonomous Loop Domain
- **`OptimizationLog`**: History of AI optimization recommendations, tracking targeted metrics (LCP, INP, latency), confidence weights, optimization status (`PENDING`, `APPLIED`, `REJECTED`), and before/after metric values.
- **`ExplanationLog`**: Human-readable natural language explanations generated by AI agents explaining optimization rationale, policy compliance checks, and risk assessments.
- **`LearningProfile`**: Performance tracking for AI agents, maintaining composite impact scores, evaluation count, and dynamic confidence weights.
- **`AgentEventLog`**: Cross-agent message and event log tracking Multi-Agent Protocol (MAP) trace IDs, event types (`recommendation`, `evaluation`, `policy_update`, `insight_report`, `recovery_action`), priority (1-100), source, and target roles.
- **`AgentPriority`**: System workload state and dynamic weight overrides for agent scheduling (`governance`, `recovery`, `optimizer`, `learning`, `insight`, `federation`).
- **`RecoveryLog`**: Autonomous recovery and rollback events triggered when performance regressions or high error rates are detected (>10% trust regression or >15% error rate).
- **`FederationMetrics`**: Anonymous cross-tenant telemetry metrics and global network consensus weight records under the Federation Data Protocol (FDP).

### 4.3 Content Experimentation Domain
- **`ContentExperiment`**: A/B test experiments on invoice content variants (e.g. CTA text, visual captions, delivery schedules) with running/paused/completed states.
- **`ContentVariant`**: Specific variant definitions within an experiment, including payload data, contextual bandit priors, and selection weights.
- **`VariantMetric`**: Granular performance metrics (impressions, clicks, conversions, dwell time) recorded for each content variant.
- **`AiAutoAction`**: Automated system actions executed by AI agents (e.g., `AUTOPUBLISH`, `SCHEDULE_UPDATE`, `AUTO_REVERT`), including webhook notification delivery status (`applied`, `reverted`, `failed`).
- **`GlobalContentSignal`**: Global contextual trends and learning feedback aggregated across experiments.

### 4.4 Audit & Governance Domain
- **`AuditLog`**: Comprehensive audit log tracking system actions (invoice operations, authentication events, AI auto-actions, security events), storing `tenantId`, `userId`, `action`, `entity`, `entityId`, `details` (JSONB), and `ipAddress`.

---

## 5. Useful Prisma CLI Commands

| Command | Description |
|---|---|
| `npx prisma validate` | Validates the syntax and structural integrity of `prisma/schema.prisma`. |
| `npx prisma generate` | Generates updated `@prisma/client` TypeScript types based on `prisma/schema.prisma`. |
| `npx prisma migrate dev` | Creates and applies a new migration in local development. |
| `npx prisma migrate deploy` | Applies pending migrations to production database. |
| `npx prisma migrate status` | Checks pending migrations against the connected database. |
| `npx prisma studio` | Launches an interactive web UI (`http://localhost:5555`) to view and edit database records. |
| `npm run db:seed` | Seeds the database with default initial data using `prisma/seed.ts`. |

---

## 6. Development Best Practices

1. **Do Not Edit Applied Migrations**: Once a migration SQL file in `prisma/migrations/` is committed, do not modify it directly. Create a new migration instead.
2. **Always Use Environment Variables**: Never hardcode connection credentials in source files. Use `process.env.DATABASE_URL`.
3. **Validate Schema Before Commit**: Run `npx prisma validate` to confirm schema validity before submitting pull requests.
4. **Mock Prisma in Unit Tests**: Unit tests in `lib/__tests__/` use isolated mocks (`vi.mock('@/lib/db')`) so tests can execute without requiring an active database server.
