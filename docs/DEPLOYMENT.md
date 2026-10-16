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
| Production | Vercel, deployed by the `deploy` job | Managed PostgreSQL; migrated by the `deploy` job | Vercel project environment variables for the app; GitHub environment `production` (`PRODUCTION_DATABASE_URL`, created by the repository owner) for migrations |

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
| Push to `main` | `build-and-test`, `e2e-smoke`, then `release`; when `release` publishes a version, `deploy`, then `post-deploy-tests` |
| Manual dispatch with `run_staging_certification: true` | `build-and-test`, `e2e-smoke`, `staging-certification` |

A separate nightly workflow (`.github/workflows/e2e-full.yml`, 19:30 UTC)
runs the full Playwright tier; it does not deploy.

On a push to `main` the job graph is:

```
build-and-test ─┐
                ├─> release ─> deploy ─> post-deploy-tests
e2e-smoke ──────┘
```

Pushing a `v*` tag no longer triggers anything: the workflow has no tag
trigger, and tags created by the `release` job with `GITHUB_TOKEN` would not
start a workflow anyway. That is why `deploy` is chained after `release` in
the same run.

**`build-and-test`** (Node 24) runs, in order:

1. `npm ci` and `prisma generate`
2. `npm run release:check`
3. `prisma validate`
4. `npm run lint`
5. `npm run docs:env-check`, `npm run docs:route-check`, `npm run docs:link-check`
6. `npm run typecheck` and `npm run typecheck:e2e`
7. `npm run test`
8. `npm run test:integration` (PGlite)
9. `npm run build`

It uploads `QA-report/` and `test-results/` as evidence.

**`e2e-smoke`** builds with `npm run e2e:build`, runs
`scripts/e2e-coverage-check.mjs`, then `npm run test:e2e:smoke` with
`E2E_WORKSPACE_AUTH_MODE=enforce`.

**`release`** runs only on pushes to `main`, after both jobs above pass, and
is the only job with write permissions (`contents`, `issues`,
`pull-requests`; the workflow default is `contents: read`). It runs in the
concurrency group `release`, so two pushes never release at the same time.
See [Versioning and tags](#versioning-and-tags). Its outputs `published` and
`version` decide whether the rest of the chain runs.

**`deploy`** runs only when `release` published a version
(`needs.release.outputs.published == 'true'`). It checks out the release
commit (the new tag, which carries the bumped `package.json` and
`CHANGELOG.md`) and runs in the `production` environment. It applies database migrations with
`prisma migrate deploy` (see [Database migrations](#database-migrations)),
builds once more as a gate, then runs
`npx vercel deploy --prod --token=$VERCEL_TOKEN`. Vercel builds the deployment
itself, using the project's environment variables, not the CI build.

**`post-deploy-tests`** (environment `staging`) runs after `deploy`, under the
same `published` condition, and the `@staging` Playwright
tier against `STAGING_NEXTAUTH_URL`, **not** against the production URL the
`deploy` job just published. The `@staging` specs write data and need sandbox
provider keys.

**`staging-certification`** (manual dispatch only) runs
`npm run release:certify` with the staging database and sandbox provider
secrets, then the `@staging` tier. `release:certify` checks
`prisma migrate status` and fails on pending or failed migrations.

### Versioning and tags

`.releaserc.json` configures semantic-release on `main` (tag format
`v${version}`). The `release` job runs it on every push to `main`:

- Commit messages decide the version: `fix:` → patch, `feat:` → minor, a
  `BREAKING CHANGE` footer → major. A push with only `chore:`, `docs:`, `ci:`,
  `test:` and similar commits publishes nothing (`published=false`) and
  therefore does not deploy.
- When a version is published, semantic-release updates `CHANGELOG.md`, bumps
  `version` in `package.json` and `package-lock.json` (`@semantic-release/npm`
  with `npmPublish: false`; nothing goes to the npm registry), commits them as
  `chore(release): X.Y.Z`, tags that commit `vX.Y.Z`, pushes both and creates a
  GitHub Release.
- The job first checks for a `v*` tag reachable from `HEAD`. Without one it
  logs the warning "no v* base tag reachable from HEAD, skipping release" and
  sets `published=false`, so semantic-release never falls back to publishing
  `v1.0.0`.
- `GITHUB_TOKEN` is enough to push the release commit and tag because `main`
  is not branch-protected. If branch protection is enabled later, the
  `release` job fails until `github-actions` gets a bypass or the job uses a
  PAT.

Tags start at `v1.2.0`: the base tag sits on `4355721` (Phase 2, 2026-08-12)
and is pushed by hand once, after the release workflow above is on `main`
(until it exists, `release` is a no-op). The first `feat:` or `fix:` push
after it publishes `v1.3.0`, which rolls up everything since v1.2.0.

Production deploys happen **only** through `release.yml`. The Vercel Git
integration is not connected (no Vercel deployments or commit statuses on
`main` as of 2026-10-16), and `vercel.json` sets
`git.deploymentEnabled.main` to `false` as a guard in case it is ever
connected. A manual escape hatch is `vercel deploy --prod` from a checkout of
the commit to ship (see [Rollback](#rollback)); apply its migrations first.

## Database migrations

Migrations live in `prisma/migrations/` and are applied with
`npx prisma migrate deploy`. The `deploy` job in `release.yml` runs it
automatically, before the build and before `vercel deploy --prod`:

1. **Check production database secret** fails the job with a clear message
   when `PRODUCTION_DATABASE_URL` is empty.
2. **Apply database migrations** runs `npx --no-install prisma migrate status`
   (informational, never fails the step) and then
   `npx --no-install prisma migrate deploy` with
   `DATABASE_URL=${{ secrets.PRODUCTION_DATABASE_URL }}`. A failed migration
   fails the job, so `vercel deploy` never runs against an unmigrated schema.

The job runs in the `production` GitHub environment (no required reviewers,
so deploys stay automatic) and in the concurrency group `production-deploy`
with `cancel-in-progress: false`, so two deploys never run `migrate deploy`
in parallel. `vercel.json` sets `git.deploymentEnabled.main` to `false`, so a
Vercel Git integration, if one is ever connected, cannot deploy `main` ahead of
the migrations this job runs.

> **Before the first automated deploy, the repository owner must create the
> `production` GitHub environment** (Settings → Environments) **and add the
> `PRODUCTION_DATABASE_URL` secret to it.** Nothing in this repo creates
> either. Without the secret the `deploy` job stops at the secret check.
> The value must be the **direct (non-pooled) connection string**:
> `prisma/schema.prisma` declares no `directUrl`, so this URL is used for DDL,
> and a PgBouncer or transaction-pooled URL breaks the advisory lock that
> `migrate deploy` takes (see [DATABASE.md](DATABASE.md#32-production-migration-execution-npx-prisma-migrate-deploy)).

Procedure for a release that contains migrations:

1. Rehearse on staging: run `npx prisma migrate deploy` against the staging
   database, then dispatch `staging-certification`, which must report no
   pending or failed migrations
   ([runbooks/release-certification.md](runbooks/release-certification.md#database-and-deployment)).
2. Merge to `main` with a `feat:` or `fix:` commit. The `deploy` job applies the migrations to production,
   then builds and deploys the new code against the migrated schema.

This order is safe only because migrations are additive (new tables, nullable
columns, indexes), so the running old version keeps working against the new
schema while the deploy is in progress. For a change that removes or tightens
something (drop a column, make a column non-null), use expand and contract:

1. Ship an additive migration and code that works with both shapes.
2. Backfill and verify.
3. Ship the contracting migration in a later release, after no deployed
   version depends on the old shape.

The workspace rollout in [WORKSPACE_RBAC.md](WORKSPACE_RBAC.md#migration-sequence)
is the worked example. Payment-lifecycle migration notes are in
[DATABASE.md](DATABASE.md).

**Manual fallback.** If the pipeline cannot run (for example the secret is
missing or GitHub Actions is down), an operator can apply migrations by hand:
`DATABASE_URL=<production direct URL> npx prisma migrate deploy`, then
`npx prisma migrate status` to confirm nothing is pending, and only then
deploy the code.

## Rollback

**Application.** Roll back by promoting the previous production deployment in
the Vercel dashboard (instant; no rebuild), or by checking out the previous
`v*` tag and running `npx vercel deploy --prod` by hand. Pushing or re-pushing
a tag does not deploy anything. Vercel environment variables are not versioned with
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

`vercel.json` runs five crons: four every 5 minutes and the retention purge
daily at 03:00 UTC. Vercel calls them with `GET` and
`Authorization: Bearer $CRON_SECRET`, which `lib/cron-auth.ts` requires in
production; without `CRON_SECRET` they return `503`.

| Path | What it does | Failure signals |
|---|---|---|
| `/api/cron/uptime` | `runUptimeChecks()` (`lib/monitoring/uptime.ts`) probes `UPTIME_MONITORED_ENDPOINTS` with a 5 s timeout (default when unset: `/api/health?db=1`, a health check with a database ping; relative entries resolve against `NEXT_PUBLIC_APP_URL`, then `NEXTAUTH_URL`, then `https://$VERCEL_URL`, so the deployed host is probed; absolute URLs are used as is), stores `UptimeCheck` rows, and sends a Slack/Discord alert for endpoints that are down | `500` from the route; gaps in `UptimeCheck` rows; the admin uptime page |
| `/api/cron/reminders` | For every enabled `InvoiceReminderRule`, creates an `InvoiceReminderOccurrence` for `SENT`, `UNPAID` and `OVERDUE` invoices whose reminder time fell within the last 24 hours. A unique `occurrenceKey` makes reruns idempotent | If the cron is down for more than 24 hours, the missed reminders are **skipped**, not caught up |
| `/api/cron/reminder-delivery` | `dispatchReminderDeliveries({ limit: 50 })` (`lib/team/reminder-delivery.ts`) claims pending delivery rows, sends through Resend or the workspace's encrypted Slack endpoint, retries after 5 min, 15 min, 1 h and 6 h, and reclaims rows stuck in `PROCESSING` for more than 10 minutes | `500` from the route; delivery rows in `RETRY`/`FAILED`; occurrences with no `SENT` delivery |
| `/api/cron/autonomy` | `runScheduledTick()` (`lib/ai/loop-scheduler.ts`) runs one autonomy-loop tick (`runLoop()`: priorities, scaling, recovery sweep with possible automatic rollbacks) when `AutonomyLoopState.nextRunAt` is due (30 s tolerance), then stores the next run time (`max(adaptive interval, 5 min)`, so the effective minimum interval is 5 minutes) and the scaler state. Answers `skipped:"paused"` until a platform admin resumes the loop (it ships paused; see [Enabling the autonomy loop](#enabling-the-autonomy-loop)), `skipped:"disabled"` when `ENABLE_AI_AUTONOMY=false`, `skipped:"not_due"` between runs and `skipped:"locked"` while another tick holds the lease. `?force=1` runs a tick that is not due. [ADR 016](./adr/016-autonomy-loop-cron-scheduling.md) | `500` from the route; `lastRunAt` in the DevTools autonomy page stops advancing while the loop is resumed |
| `/api/cron/retention` (daily, `0 3 * * *`) | `runRetentionPurge()` (`lib/retention/purge.ts`) deletes `AuditLog` rows older than 12 months, nulls `AuditLog.ipAddress` older than 90 days, and deletes `SENT`/`FAILED`/`SKIPPED` reminder occurrences (with their deliveries) scheduled more than 12 months ago, in id batches (`RETENTION_BATCH_SIZE` x `RETENTION_MAX_BATCHES` per step). Payments, invoices and receipts are never touched. Returns `skipped:"disabled"` until `RETENTION_ENABLED=true`, `skipped:"locked"` while another run holds the `CronLease`, and `500` for an invalid `RETENTION_*` configuration. Policy: [SECURITY.md](../SECURITY.md#retention-and-deletion) | `500` from the route; `truncated:true` in the response or audit details (more rows than one run's cap; the next run continues); no new `RETENTION_PURGE` audit row in a day |

Vercel shows cron invocations and their status codes in the project's
**Cron Jobs** page.

### Enabling the autonomy loop

The loop can roll back AI-applied changes on its own, so it ships paused: the
first deploy of `/api/cron/autonomy` creates the `AutonomyLoopState` row with
`paused = true` and every tick answers `{"skipped":"paused"}`.

1. Sign in as a platform admin (`ADMIN_USER_IDS`) and open
   `/devtools/ai-autonomy`.
2. Press **Resume**. This sets `paused = false` (and also runs one tick in the
   serving instance).
3. Within 5 minutes, check the cron response or the `lastRunAt` /
   `nextRunAt` values (`GET /api/cron/autonomy` with the cron bearer answers
   `{"ran":true,...}` or `{"skipped":"not_due",...}`).

**Pause** on the same page stops production ticks. If nobody resumes the loop,
it never runs in production.

### Enabling the retention purge

Deletes are irreversible, so the first run is gated. The 12-month and 90-day
periods are the product decision; `RETENTION_ENABLED` is only a first-run
safety gate.

1. Deploy with `RETENTION_ENABLED` unset. The daily cron answers
   `{"skipped":"disabled"}` and writes nothing.
2. Run a dry run and review the counts (`auditLogsDeleted`,
   `ipAddressesCleared`, `reminderOccurrencesDeleted`):
   `curl -H "Authorization: Bearer $CRON_SECRET" "$URL/api/cron/retention?dryRun=1"`
3. Set `RETENTION_ENABLED=true` in the Vercel environment and redeploy.
4. After the next 03:00 UTC run, check its `RETENTION_PURGE` audit row
   (`entity` `Retention`, counts in `details`). `truncated: true` means the
   backlog is larger than one run's cap; later runs continue it.

To pause purging, unset `RETENTION_ENABLED` (or set `RETENTION_DRY_RUN=true`)
and redeploy.

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
3. Check `GET /api/health?db=1` returns `200` with `checks.db: "ok"` (the
   bare `/api/health` does not touch the database).
4. Check the Sentry release for new errors.
5. If the release touched payments or email, run the relevant rows of the
   provider contract matrices in
   [runbooks/release-certification.md](runbooks/release-certification.md).
   Run them against staging, never against production with real money.
6. Confirm `npx prisma migrate status` against production reports nothing
   pending.
