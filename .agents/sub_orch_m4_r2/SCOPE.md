# Scope: Milestone M4 (PostgreSQL Migration & DB Setup)

## Architecture
Prisma ORM with PostgreSQL provider (`DATABASE_URL` env var). Migration files in `prisma/migrations/`. Documentation in `docs/DATABASE.md`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | PostgreSQL Provider | Ensure `prisma/schema.prisma` uses provider = "postgresql" with DATABASE_URL env var | M4 | DISPATCH.md |
| 2 | DB Migrations | Verify existing migration files under `prisma/migrations/` match full schema | M4 | DISPATCH.md |
| 3 | Database Documentation | Document setup steps, running migrations, and env vars in `docs/DATABASE.md` | M4 | DISPATCH.md |
| 4 | Verification | Ensure `npx tsc --noEmit` and `npm run test` pass cleanly | M4 | DISPATCH.md |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M4 | PostgreSQL Migration & DB Setup | Schema provider, migration verification, docs/DATABASE.md, test verification | None | IN_PROGRESS |

## Interface Contracts
- `DATABASE_URL` environment variable format: `postgresql://user:password@localhost:5432/invosmart?schema=public`
- `prisma/schema.prisma` datasource: `provider = "postgresql"`, `url = env("DATABASE_URL")`
