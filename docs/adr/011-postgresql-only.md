# 11. PostgreSQL in Every Environment

## Status
Accepted (2026-10-16, recorded retroactively). Supersedes [ADR 002](002-prisma-orm-multi-db.md).

## Context
ADR 002 chose SQLite for local development and PostgreSQL for production. The schema later started relying on PostgreSQL-only features: native enums, `String[]` columns (e.g. `ApiKey.scopes`), JSONB, and raw `SELECT … FOR UPDATE` row locks in payment settlement (`lib/payments/settlement.ts`). Keeping one schema valid for both engines blocked that work. The Phase 1 migration (`prisma/migrations/20260811000000_init_postgresql_schema`) moved every environment to PostgreSQL.

## Decision
- **Production and development**: use **PostgreSQL** through Prisma (`prisma/schema.prisma:5-8`, `provider = "postgresql"`).
- **Migrations**: versioned in `prisma/migrations/`, applied with `prisma migrate deploy`.
- **Automated tests**: e2e and DB integration tests run against an in-memory PostgreSQL (**PGlite**, `@electric-sql/pglite`) served over the wire protocol (`test/e2e/support/db/`, `test/integration/db/`), so they need no external database.

## Consequences
### Positive
*   **One dialect**: dev, test and production run the same SQL, so there are no dialect-specific migration bugs.
*   **PostgreSQL features are available**: enums, arrays, JSONB and row locks for money-safe settlement.
*   **Tests need no database**: CI and new developers can run e2e and integration tests without Docker.

### Negative / Trade-offs
*   **Local development needs PostgreSQL**: a local server or Docker container (see [DATABASE.md](../DATABASE.md)).
*   **PGlite is not full PostgreSQL**: it is close to production behavior, but extensions and some concurrency behavior can differ.
