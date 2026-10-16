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
| Production | Vercel, deployed by the `deploy` job | Managed PostgreSQL; migrated by the `deploy` job | Vercel project environment variables for the app; GitHub environment `production` (`PRODUCTION_DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, created by the repository owner; see [Production prerequisites](#production-prerequisites)) for the `deploy` job |

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
| Manual dispatch from `main` with `deploy_ref: vX.Y.Z` | `build-and-test`, `e2e-smoke`, then `deploy` of that tag (see [Deploying an existing tag](#deploying-an-existing-tag)) |

A manual dispatch with neither input set runs only the two gates and deploys
nothing.

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
   and `npm run test:doc-checks` (tests for the two docs check scripts)
6. `npm run typecheck` and `npm run typecheck:e2e`
7. `npm run test`
8. `npm run test:integration` (PGlite)
9. `npm run build`

It uploads `QA-report/` and `test-results/` as evidence.

**`e2e-smoke`** builds with `npm run e2e:build`, runs
`scripts/e2e-coverage-check.mjs`, then `npm run test:e2e:smoke` with
`E2E_WORKSPACE_AUTH_MODE=enforce`.

**`release`** runs only on pushes to `main`, after both jobs above pass, and
is the only job with write permissions (`contents: write`; the workflow
default is `contents: read`). It runs in the
concurrency group `release`, so two pushes never release at the same time.
See [Versioning and tags](#versioning-and-tags). Its outputs `published` and
`version` decide whether the rest of the chain runs.

**`deploy`** runs in the `production` environment when `release` published a
version (`needs.release.outputs.published == 'true'`), or on a manual
dispatch with `deploy_ref` (see [Deploying an existing tag](#deploying-an-existing-tag)).
In order, it:

1. resolves the tag to deploy (the new release tag, or `deploy_ref`) and
   rejects anything that is not `vX.Y.Z`;
2. checks out that tag (the release commit, which carries the bumped
   `package.json` and `CHANGELOG.md`) and fails unless the tag exists and is
   reachable from `main`;
3. runs `npm ci` and `prisma generate`;
4. **Check deployment secrets**: fails, before anything touches production,
   when any of `PRODUCTION_DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` or
   `VERCEL_PROJECT_ID` is empty, naming the missing secrets (never values);
5. runs `npm run build` as a gate, so a build failure stops the job before
   any migration;
6. applies database migrations with `prisma migrate deploy` (see
   [Database migrations](#database-migrations));
7. runs `npx --yes vercel@62.0.0 deploy --prod --token=$VERCEL_TOKEN` with
   `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` in the environment. They select the
   Vercel project, since `.vercel/` is gitignored and the checkout is not
   linked. The CLI version is pinned so a new Vercel CLI release cannot
   change the deploy unannounced; bump it deliberately.

Vercel builds the deployment itself, using the project's environment
variables, not the CI build.

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
- The job first checks for a `v[0-9]*` tag reachable from `HEAD`. Without one it
  logs the warning "no v* base tag reachable from HEAD, skipping release" and
  sets `published=false`, so semantic-release never falls back to publishing
  `v1.0.0`.
- `.releaserc.json` sets `successComment`, `failComment` and
  `releasedLabels` to `false` on `@semantic-release/github`: no comments or
  labels on released issues and PRs, and no failure issues. The tag is
  pushed before that plugin's `success` step, so a failure there would mark
  the job failed and skip `deploy` for a release that is already tagged.
  The GitHub Release itself is still created.
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
connected. To ship a release whose `deploy` never ran, use
[Deploying an existing tag](#deploying-an-existing-tag). The last-resort
escape hatch is `vercel deploy --prod` by hand from a checkout of the tag to
ship (see [Rollback](#rollback)); apply its migrations first.

### Production prerequisites

Nothing in this repository creates GitHub environments or secrets, and the
repository has none today. Before the first automated deploy, the
repository owner sets these up in **Settings → Environments**:

**`production`** (used by `deploy`):

| Setting | Value |
|---|---|
| Deployment branches and tags | **Selected branches: `main` only**. The push path runs on `main`, and a `deploy_ref` dispatch must be started from `main` |
| Required reviewers | None, so deploys stay fully automatic |
| Secret `PRODUCTION_DATABASE_URL` | The **direct (non-pooled)** PostgreSQL connection string (see [Database migrations](#database-migrations)) |
| Secret `VERCEL_TOKEN` | A Vercel access token with access to the project's team |
| Secret `VERCEL_ORG_ID` | The Vercel team (or personal account) ID. `vercel link` writes it to `.vercel/project.json` as `orgId` |
| Secret `VERCEL_PROJECT_ID` | The Vercel project ID (`projectId` in `.vercel/project.json`, or the project's **Settings → General**) |

Until all four secrets exist, `deploy` stops at **Check deployment secrets**
with the list of missing names, before any migration or deploy.

**`staging`** (used by `post-deploy-tests` after every deploy, and by
`staging-certification`):

| Kind | Name | Used by |
|---|---|---|
| Secret | `STAGING_NEXTAUTH_URL` (base URL of the staging deployment) | both |
| Secret | `E2E_STAGING_USER_EMAIL`, `E2E_STAGING_USER_PASSWORD` | both |
| Secret | `E2E_STAGING_SLACK_WEBHOOK_URL` | both |
| Secret | `STAGING_CRON_SECRET` | both |
| Variable | `E2E_STAGING_INBOX` | both |
| Secret | `STAGING_DATABASE_URL`, `STAGING_NEXTAUTH_SECRET`, `STAGING_STRIPE_SECRET_KEY`, `STAGING_STRIPE_WEBHOOK_SECRET`, `STAGING_STRIPE_PUBLISHABLE_KEY`, `STAGING_MIDTRANS_SERVER_KEY`, `STAGING_MIDTRANS_CLIENT_KEY`, `STAGING_RESEND_API_KEY`, `STAGING_RESEND_FROM_EMAIL`, `STAGING_RESEND_WEBHOOK_SECRET` | `staging-certification` only |

Without the `staging` secrets, `post-deploy-tests` fails after a successful
production deploy; production is already live at that point.

### Deploying an existing tag

Use this when a version was tagged but not deployed (the `deploy` job was
skipped, or the run was lost), or to redeploy a released tag:

1. **Actions → Release Build & Deploy → Run workflow**.
2. **Use workflow from: `main`**. Any other branch fails the tag check, and
   the `production` environment only admits `main`.
3. Set `deploy_ref` to an existing tag, for example `v1.3.0`. Leave
   `run_staging_certification` off unless you also want that job.

The run executes `build-and-test` and `e2e-smoke` on `main`, then `deploy`
for the tag. `deploy` waits for the gates but does not depend on their
result: it deploys the tag, which was gated when it was released, and
rebuilds it before migrating. It rejects a `deploy_ref` that is not of the
form `vX.Y.Z`, does not exist, or is not reachable from `main`. The
`deploy` steps are the same as on the push path, including `prisma migrate
deploy`. `post-deploy-tests` does not run on this path.

**When `deploy` fails** (a missing secret added afterwards, a Vercel or
database outage), open the failed run and use **Re-run failed jobs**. It
re-runs `deploy` (and `post-deploy-tests`, which depends on it) with the
same `release` outputs and does not release again. `prisma migrate deploy`
only applies pending migrations, so re-running it after a migration already
succeeded is safe. If the run is too old to re-run, use the dispatch above.
If `release` itself failed after pushing the tag, re-running it publishes
nothing (the tag already exists), so `deploy` stays skipped; use the
dispatch above with that tag.

## Database migrations

Migrations live in `prisma/migrations/` and are applied with
`npx prisma migrate deploy`. The `deploy` job in `release.yml` runs it
automatically, before the build and before `vercel deploy --prod`:

1. **Check deployment secrets** fails the job, naming the missing secrets,
   when `PRODUCTION_DATABASE_URL` or any of the Vercel secrets is empty.
2. **Build** runs next, so a build failure stops the job before any
   migration.
3. **Apply database migrations** first registers the database host from
   `PRODUCTION_DATABASE_URL` as a log mask (the repository is public and
   Prisma prints the host in its output and connection errors), then runs
   `npx --no-install prisma migrate status` (informational, never fails the
   step) and `npx --no-install prisma migrate deploy` with
   `DATABASE_URL=${{ secrets.PRODUCTION_DATABASE_URL }}`. A failed migration
   fails the job, so `vercel deploy` never runs against an unmigrated schema.

The job runs in the `production` GitHub environment (deployment branches
limited to `main`, no required reviewers, so deploys stay automatic) and in
the concurrency group `production-deploy`
with `cancel-in-progress: false`, so two deploys never run `migrate deploy`
in parallel. `vercel.json` sets `git.deploymentEnabled.main` to `false`, so a
Vercel Git integration, if one is ever connected, cannot deploy `main` ahead of
the migrations this job runs.

> **Before the first automated deploy, the repository owner must create the
> `production` GitHub environment and its four secrets** (see
> [Production prerequisites](#production-prerequisites)). Without them the
> `deploy` job stops at the secret check.
> `PRODUCTION_DATABASE_URL` must be the **direct (non-pooled) connection string**:
> `prisma/schema.prisma` declares no `directUrl`, so this URL is used for DDL,
> and a PgBouncer or transaction-pooled URL breaks the advisory lock that
> `migrate deploy` takes (see [DATABASE.md](DATABASE.md#32-production-migration-execution-npx-prisma-migrate-deploy)).

Procedure for a release that contains migrations:

1. Rehearse on staging: run `npx prisma migrate deploy` against the staging
   database, then dispatch `staging-certification`, which must report no
   pending or failed migrations
   ([runbooks/release-certification.md](runbooks/release-certification.md#database-and-deployment)).
2. Merge to `main` with a `feat:` or `fix:` commit. The `deploy` job builds,
   applies the migrations to production, then deploys the new code against
   the migrated schema.

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
`v*` tag and running `npx --yes vercel@62.0.0 deploy --prod` by hand (with
`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set, or after `vercel link`). Pushing or re-pushing
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

`vercel.json` runs three crons, each every 5 minutes. Vercel calls them with
`GET` and `Authorization: Bearer $CRON_SECRET`, which `lib/cron-auth.ts`
requires in production; without `CRON_SECRET` they return `503`.

| Path | What it does | Failure signals |
|---|---|---|
| `/api/cron/uptime` | `runUptimeChecks()` (`lib/monitoring/uptime.ts`) probes `UPTIME_MONITORED_ENDPOINTS` with a 5 s timeout (default when unset: `/api/health?db=1`, a health check with a database ping; relative entries resolve against `NEXT_PUBLIC_APP_URL`, then `NEXTAUTH_URL`, then `https://$VERCEL_URL`, so the deployed host is probed; absolute URLs are used as is), stores `UptimeCheck` rows, and sends a Slack/Discord alert for endpoints that are down | `500` from the route; gaps in `UptimeCheck` rows; the admin uptime page |
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
3. Check `GET /api/health?db=1` returns `200` with `checks.db: "ok"` (the
   bare `/api/health` does not touch the database).
4. Check the Sentry release for new errors.
5. If the release touched payments or email, run the relevant rows of the
   provider contract matrices in
   [runbooks/release-certification.md](runbooks/release-certification.md).
   Run them against staging, never against production with real money.
6. Confirm `npx prisma migrate status` against production reports nothing
   pending.
