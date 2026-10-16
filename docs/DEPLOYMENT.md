# Deployment

How InvoSmart gets from a commit to production: the environments, the CI
release flow, database migrations, rollback and the scheduled jobs. It
describes what `.github/workflows/release.yml`, `vercel.json` and the scripts
do today. Points that are not automated, or not decided, are marked
**Open decision**.

Related: [runbooks/release-certification.md](runbooks/release-certification.md)
(staging evidence and provider contracts), [DATABASE.md](DATABASE.md)
(Prisma commands), [WORKSPACE_RBAC.md](WORKSPACE_RBAC.md) (workspace rollout),
[../SECURITY.md](../SECURITY.md) (secrets), [`.env.example`](../.env.example)
(every variable).

## Environments

| Environment | Runs on | Database | Configuration |
|---|---|---|---|
| Local | `npm run dev` (port 1234), Node 24 (`.nvmrc`) | Your PostgreSQL via `DATABASE_URL`; `npx prisma migrate dev` | `.env` copied from `.env.example` |
| E2E / CI | `next start` on an `npm run e2e:build` build, started by `playwright.config.ts` | In-memory PGlite (`npm run e2e:db`) | Fixed values from the e2e harness; no `.env`, no provider accounts. See [E2E_TESTING.md](E2E_TESTING.md) |
| Staging | A Vercel deployment at the URL in the `STAGING_NEXTAUTH_URL` secret | Staging PostgreSQL (`STAGING_DATABASE_URL`) | GitHub environment `staging` (`STAGING_*` secrets) for CI checks; the Vercel project's environment variables for the app itself |
| Production | Vercel, deployed by the `deploy` job | Managed PostgreSQL | Vercel project environment variables |

> **Open decision / verify:** the workflows never deploy to staging; `deploy`
> only runs `vercel deploy --prod`. How the staging deployment is created
> (Vercel preview of a branch, a separate project, or manual) is not
> recorded anywhere in the repo. Document it here once confirmed.

Production must set every variable marked required in `.env.example`, plus:

- `WORKSPACE_AUTH_MODE=enforce` (after the backfill; see [Workspace auth mode](#workspace-auth-mode))
- `ADMIN_USER_IDS`
- `CRON_SECRET`
- `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY`
- the Stripe, Midtrans and Resend keys and webhook secrets
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, so `/api/v1` rate limits and idempotency hold across instances

`INVOSMART_E2E_PROVIDER_BASE_URL` must never be set outside the e2e suite.

## Release flow

All of this is in `.github/workflows/release.yml`.

| Trigger | Jobs that run |
|---|---|
| Pull request to `main` | `build-and-test`, `e2e-smoke` |
| Push to `main` | `build-and-test`, `e2e-smoke` |
| Push of a tag `v*` | `build-and-test`, `e2e-smoke`, then `deploy`, then `post-deploy-tests` |
| Manual dispatch with `run_staging_certification: true` | `build-and-test`, `e2e-smoke`, `staging-certification` |

A separate nightly workflow (`.github/workflows/e2e-full.yml`, 19:30 UTC)
runs the full Playwright tier; it does not deploy.

**`build-and-test`** (Node 24) runs, in order:

1. `npm ci` and `prisma generate`
2. `npm run release:check`
3. `prisma validate`
4. `npm run lint`
5. `npm run docs:env-check`
6. `npm run typecheck` and `npm run typecheck:e2e`
7. `npm run test`
8. `npm run test:integration` (PGlite)
9. `npm run build`

It uploads `QA-report/` and `test-results/` as evidence.

**`e2e-smoke`** builds with `npm run e2e:build`, runs
`scripts/e2e-coverage-check.mjs`, then `npm run test:e2e:smoke` with
`E2E_WORKSPACE_AUTH_MODE=enforce`.

**`deploy`** runs only for `v*` tags and only after both jobs above pass. It
builds once more as a gate, then runs
`npx vercel deploy --prod --token=$VERCEL_TOKEN`. Vercel builds the deployment
itself, using the project's environment variables, not the CI build. The job
does **not** run database migrations.

**`post-deploy-tests`** (environment `staging`) runs the `@staging` Playwright
tier against `STAGING_NEXTAUTH_URL`, **not** against the production URL the
`deploy` job just published. The `@staging` specs write data and need sandbox
provider keys.

**`staging-certification`** (manual dispatch only) runs
`npm run release:certify` with the staging database and sandbox provider
secrets, then the `@staging` tier. `release:certify` checks
`prisma migrate status` and fails on pending or failed migrations.

### Versioning and tags

`.releaserc.json` configures semantic-release on `main` (tag format `v${version}`,
writes `CHANGELOG.md`). The **Semantic Release** step in `build-and-test` is
currently disabled (`if: false`) until Phase 8 of
`.plans/tech-stack-upgrade.md` settles the base version. Until then no tag is
created automatically, so a production deploy happens only when someone
pushes a `v*` tag by hand.

> **Open decision / verify:** confirm whether `v*` tags exist on the remote
> (the local clone has none) and whether the Vercel Git integration also
> deploys pushes to `main`. If it does, production is deployed outside this
> pipeline and its gates.

## Database migrations

Migrations live in `prisma/migrations/` and are applied with
`npx prisma migrate deploy`. **No pipeline runs this command.** It is a manual
operator step against the target database.

Procedure for a release that contains migrations:

1. Rehearse on staging: run `npx prisma migrate deploy` against the staging
   database, then dispatch `staging-certification`, which must report no
   pending or failed migrations
   ([runbooks/release-certification.md](runbooks/release-certification.md#database-and-deployment)).
2. Apply to production **before** pushing the release tag:
   `DATABASE_URL=<production> npx prisma migrate deploy`. Then run
   `npx prisma migrate status` and confirm nothing is pending.
3. Push the `v*` tag. The deploy runs the new code against the already
   migrated schema.

This order is safe only because migrations are additive (new tables, nullable
columns, indexes), so the running old version keeps working against the new
schema. For a change that removes or tightens something (drop a column, make
a column non-null), use expand and contract:

1. Ship an additive migration and code that works with both shapes.
2. Backfill and verify.
3. Ship the contracting migration in a later release, after no deployed
   version depends on the old shape.

The workspace rollout in [WORKSPACE_RBAC.md](WORKSPACE_RBAC.md#migration-sequence)
is the worked example. Payment-lifecycle migration notes are in
[DATABASE.md](DATABASE.md).

> **Open decision:** whether to automate `prisma migrate deploy`, either as a
> CI step before `vercel deploy` (needs a production `DATABASE_URL` secret in
> CI) or as part of the Vercel build command. Until then, a tag pushed without
> step 2 deploys code against an unmigrated database.

## Rollback

**Application.** Roll back by promoting the previous production deployment in
the Vercel dashboard (instant; no rebuild), or by redeploying the previous `v*`
tag through the workflow. Vercel environment variables are not versioned with
the deployment, so revert any env change separately.

**Database.** Prisma has no down-migrations. Do not roll a migration back by
hand in production. Instead:

- Leave additive changes in place. The previous application version ignores
  new tables and columns, so an app-only rollback is enough.
- Fix a bad migration forward with a new migration.
- If data was damaged, restore from the provider's backups. See
  [runbooks/backup-restore.md](runbooks/backup-restore.md) for the restore
  and verification steps.

> **Open decision:** the backup schedule, retention and a tested restore
> procedure for the production database are not documented. They depend on
> the managed PostgreSQL provider.

### Workspace auth mode

`WORKSPACE_AUTH_MODE` is the switch for the workspace model:

- `compat`: falls back to user-owned rows when a membership is missing.
- `enforce`: fails closed.

Moving from `enforce` back to `compat` is the documented rollback while the
compatibility window is open
([WORKSPACE_RBAC.md](WORKSPACE_RBAC.md#migration-sequence)). Change it in the
Vercel environment variables and redeploy.

## Scheduled jobs

`vercel.json` runs three crons, each every 5 minutes. Vercel calls them with
`GET` and `Authorization: Bearer $CRON_SECRET`, which `lib/cron-auth.ts`
requires in production; without `CRON_SECRET` they return `503`.

| Path | What it does | Failure signals |
|---|---|---|
| `/api/cron/uptime` | `runUptimeChecks()` (`lib/monitoring/uptime.ts`) probes `UPTIME_MONITORED_ENDPOINTS` with a 5 s timeout (**set it in production**: the fallback `DEFAULT_ENDPOINTS` are absolute `http://localhost:3000/...` URLs, so without it production probes localhost; relative entries resolve against `NEXTAUTH_URL`/`VERCEL_URL`), stores `UptimeCheck` rows, and sends a Slack/Discord alert for endpoints that are down | `500` from the route; gaps in `UptimeCheck` rows; the admin uptime page |
| `/api/cron/reminders` | For every enabled `InvoiceReminderRule`, creates an `InvoiceReminderOccurrence` for `SENT`, `UNPAID` and `OVERDUE` invoices whose reminder time fell within the last 24 hours. A unique `occurrenceKey` makes reruns idempotent | If the cron is down for more than 24 hours, the missed reminders are **skipped**, not caught up |
| `/api/cron/reminder-delivery` | `dispatchReminderDeliveries({ limit: 50 })` (`lib/team/reminder-delivery.ts`) claims pending delivery rows, sends through Resend or the workspace's encrypted Slack endpoint, retries after 5 min, 15 min, 1 h and 6 h, and reclaims rows stuck in `PROCESSING` for more than 10 minutes | `500` from the route; delivery rows in `RETRY`/`FAILED`; occurrences with no `SENT` delivery |

Vercel shows cron invocations and their status codes in the project's
**Cron Jobs** page.

If reminders are not arriving, rows are stuck in `PROCESSING` or deliveries
keep failing, follow [runbooks/reminder-delivery.md](runbooks/reminder-delivery.md).
For what each failure signal feeds into, see
[OBSERVABILITY.md](OBSERVABILITY.md).

## After every production deploy

1. In the `deploy` job log, check that the Vercel URL was printed, then open
   it and sign in.
2. Run `curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/uptime"`.
   It must not return `401`. The same request with the secret in the query
   string instead of the header must return `401`.
3. Check `GET /api/health`.
4. Check the Sentry release for new errors.
5. If the release touched payments or email, run the relevant rows of the
   provider contract matrices in
   [runbooks/release-certification.md](runbooks/release-certification.md).
   Run them against staging, never against production with real money.
6. Confirm `npx prisma migrate status` against production reports nothing
   pending.
