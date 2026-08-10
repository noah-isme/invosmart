# 2. Prisma ORM Multi-DB Strategy

## Status
Accepted

## Context
The application requires type-safe database access and easy schema management to ensure developer velocity and data integrity. Furthermore, we need a local development environment that requires zero configuration to streamline onboarding and daily development workflows.

## Decision
We will use **Prisma ORM** with **SQLite** for local development and **PostgreSQL** for the production environment.

## Consequences
### Positive
*   **Type Safety**: Prisma provides end-to-end type safety, catching database-related errors at compile time.
*   **Unified Schema**: A single Prisma schema definition can generate migrations and clients for both SQLite and PostgreSQL.
*   **Zero-Config Dev**: SQLite allows developers to run the application locally without running a dedicated database server or Docker container.

### Negative / Trade-offs
*   **Feature Disparity**: Some PostgreSQL-specific features (e.g., specific JSONB operations, full-text search, certain indexing types) cannot be used if they are not supported by SQLite, as the schema must remain compatible with both.
*   **Migration Complexities**: Occasionally, maintaining migrations that apply cleanly to both database engines requires extra care.
