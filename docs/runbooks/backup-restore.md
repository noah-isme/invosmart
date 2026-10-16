# Runbook: database backup and restore

What the repository does and does not provide for backups, a provider-neutral restore procedure for managed PostgreSQL, and how restores interact with Prisma migrations.

Related: [DEPLOYMENT.md](../DEPLOYMENT.md#rollback) (rollback policy), [DATABASE.md](../DATABASE.md) (migration workflow, data model), [reminder-delivery.md](./reminder-delivery.md), [release-certification.md](./release-certification.md).

> **Gap:** the production PostgreSQL provider is not named anywhere in the repository (`docs/DATABASE.md` lists AWS RDS, Supabase and Neon only as examples). Every provider-specific step below is therefore a placeholder that must be filled in by whoever owns the production database. [DEPLOYMENT.md](../DEPLOYMENT.md#rollback) records the same open decision: backup schedule, retention and a tested restore procedure are not documented.

## What the repository provides

Confirmed by searching the tree (excluding `node_modules`, `.next`, `graphify-out`) for `pg_dump`, `pg_restore`, `backup`, `PITR` and `point-in-time`: the only hits are the two documents above that say the procedure is undocumented.

| Item | Status |
|---|---|
| Database | PostgreSQL through Prisma (`prisma/schema.prisma`, `provider = "postgresql"`, `url = env("DATABASE_URL")`). No `directUrl` or shadow database is configured |
| Backup scripts, cron or workflow | **None.** `vercel.json` has only the three crons (`/api/cron/uptime`, `/api/cron/reminders`, `/api/cron/reminder-delivery`). `.github/workflows/` has `release.yml` and `e2e-full.yml`, neither dumps a database. `package.json` has no backup script |
| Migrations | 9 forward-only SQL migrations in `prisma/migrations/` plus `migration_lock.toml`. No down migrations (Prisma does not generate them) |
| Migration status check | `npm run release:certify` runs `prisma migrate status` against `STAGING_DATABASE_URL` (`scripts/release-certification.mjs`, `--check-migrations`) |
| Applying migrations | By hand: `npx prisma migrate deploy`. No CI or Vercel step runs it ([DATABASE.md](../DATABASE.md), [DEPLOYMENT.md](../DEPLOYMENT.md)) |
| Seed / data scripts | `prisma/seed.ts` (`npm run db:seed`), `scripts/backfill-personal-workspaces.ts`. Neither is a restore tool |
| Dangerous scripts | `npm run db:push` (`prisma db push`) can alter schema outside migration history. Never run it against production or a restored copy you intend to verify |

Backups are therefore entirely the database provider's responsibility.

## What must be backed up

| Data | Where | Recovery source |
|---|---|---|
| All application state: users, workspaces, invoices, payments, audit logs, reminders, uptime checks, AI action history | PostgreSQL `DATABASE_URL` | Provider backups (this runbook) |
| Encrypted Slack webhooks (`WorkspaceNotificationEndpoint.secretCiphertext`) | PostgreSQL, but undecryptable without `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` | The key itself must be stored in a secrets manager independent of the database. A restored database with a lost key makes every Slack reminder fail with `invalid_config` ([reminder-delivery.md](./reminder-delivery.md#2b-slack-endpoint-decrypt-failure)) |
| Secrets and configuration | Vercel project environment variables (not versioned with deployments, per [DEPLOYMENT.md](../DEPLOYMENT.md#rollback)) | Keep an out-of-band, access-controlled record of variable names and owners; `.env.example` is the canonical name list. Values for `NEXTAUTH_SECRET`, `INVOICE_SHARE_SECRET` and provider keys cannot be regenerated without side effects (for example existing public invoice links stop validating if the share secret changes) |
| Redis (Upstash or Vercel KV) | `lib/api-v1/redis.ts`, `lib/ai/orchestrator.ts`, `lib/ai/scaler.ts`, `lib/cache/theme-suggestions.ts` | Rate limits, idempotency keys, caches and the agent stream; the code falls back to process memory when absent ([INTEGRATIONS.md](../INTEGRATIONS.md)). |

> **Gap:** whether `/api/v1` idempotency keys held only in Redis are acceptable to lose after an incident has not been assessed in the docs. Treat Redis as disposable unless the owner decides otherwise.

> **Gap:** no off-provider copy of the database exists. A single provider-account compromise or deletion would remove both the database and its backups.

## Recommended provider-level configuration

These are recommendations, not current state. Fill in the provider-specific values and record them in [DEPLOYMENT.md](../DEPLOYMENT.md) when decided.

1. **Automated daily snapshots** with a retention of at least 7 days (30 days is typical for invoicing data).
2. **Point-in-time recovery (PITR)** enabled, so the database can be restored to any second inside the retention window (for example just before a destructive deploy or bad bulk update).
3. **Backups in a different failure domain** from the primary: at minimum a different region; ideally a periodic logical dump stored outside the provider account.
4. **Restore access** limited to named owners; restores create a *new* database instance on most managed providers and never overwrite the original.
5. **A quarterly restore drill** using the staging procedure below, with the result and the measured time recorded.

> **Gap:** provider name, snapshot schedule, retention, PITR window, region, who can restore, and RTO/RPO targets are all unrecorded. Owner: whoever administers the production database.

Optional logical dump, valid on any PostgreSQL (not provider specific, not currently automated):

```bash
# Run from a trusted machine with network access to the database.
pg_dump --format=custom --no-owner --file="invosmart-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
# Restore into an EMPTY database:
pg_restore --no-owner --dbname="$TARGET_DATABASE_URL" invosmart-<timestamp>.dump
```

Use the provider's connection string for direct (non-pooled) connections for dumps; a pooler in transaction mode is not suitable for `pg_dump`.

---

## Restore procedure

### Symptom

Data loss or corruption: a bad bulk update, accidental deletes, a faulty migration that damaged data, or loss of the database instance.

### Impact

Depends on scope. Invoices, payments and audit history are the system of record. Between the restore point and the incident, writes are lost from the restored copy, including payment webhooks that Stripe and Midtrans already delivered ([DATABASE.md](../DATABASE.md) describes `PaymentEvent` as the webhook history).

### Decide first: is a restore the right tool?

- **Application bug, schema fine:** roll back the application by promoting the previous Vercel deployment ([DEPLOYMENT.md](../DEPLOYMENT.md#rollback)). No database change is needed because migrations are additive and the previous version ignores new columns and tables.
- **Bad migration:** fix forward with a new migration (see [Interaction with Prisma migrations](#interaction-with-prisma-migrations)). Do not hand-edit production.
- **Damaged or lost data:** restore, as below.

### Diagnosis (read-only)

1. Establish the time of the last known-good state (deploy time, incident time, `AuditLog.createdAt`).
2. Identify the extent of damage with read-only queries, for example:
   ```sql
   SELECT date_trunc('hour', "createdAt") AS hour, "action", count(*)
   FROM "AuditLog" WHERE "createdAt" > now() - interval '24 hours'
   GROUP BY 1, 2 ORDER BY 1, 2;
   ```
3. Record the current migration state before touching anything:
   ```bash
   DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
   ```
4. Freeze writes if possible (maintenance window or promote a read-only deployment), so the picture does not change while you work.

> **Gap:** the application has no maintenance mode or read-only switch. The nearest levers are removing the cron entries from `vercel.json` and redeploying, or taking the deployment offline in Vercel.

### Fix: restore to a new instance first

Always restore into a **new** database, verify, then switch. Never restore over production in place.

1. In the provider console, create a new instance from a snapshot or from PITR at the chosen timestamp (UTC). **Provider-specific:** the exact menu and CLI differ per provider.
   > **Gap:** fill in the provider's PITR steps and CLI commands here once the provider is recorded.
2. Obtain the new instance's connection string (`RESTORED_DATABASE_URL`).
3. Run the [staging verification](#verification-restore-to-staging) against it.
4. If the restore point is older than the deployed code expects, reconcile migrations (see below).
5. Pause the crons so the app does not act on stale data while it is switched. In particular `/api/cron/reminder-delivery` would send reminders from the restored `InvoiceReminderDelivery` state, and rows that were `SENT` after the restore point appear unsent and could be sent a second time. Check these before re-enabling:
   ```sql
   SELECT "status", count(*) FROM "InvoiceReminderDelivery" GROUP BY 1;
   ```
   Email is protected by the Resend idempotency key only within Resend's idempotency window; Slack is not protected ([reminder-delivery.md](./reminder-delivery.md#4-duplicate-sends)). If in doubt, mark post-restore-point occurrences as `SKIPPED` after confirming with the business owner.
6. Switch the app: update `DATABASE_URL` in the Vercel project environment (production scope) to the restored instance and redeploy (environment variables are read at build or deploy time for this project, so a redeploy is required). Keep the old instance until the verification below passes.
7. Reconcile external money: for the window between the restore point and the incident, compare Stripe and Midtrans dashboards against `Payment`/`PaymentAttempt` and replay or manually record missing settlements. Provider webhooks can be resent from the provider dashboards; `PaymentEvent` has a unique `(provider, providerEventId)`, so replays are deduplicated.

### Rollback (of the restore)

Because the original instance is kept, set `DATABASE_URL` back and redeploy. Anything written to the restored instance after the switch is not on the original and must be exported first if it matters (for example with `pg_dump --table` of the tables concerned).

### Escalation

1. Database owner or provider support for restore failures and PITR window questions.
2. Engineering lead for the decision to switch production.
3. Business owner before replaying payments or suppressing reminders.

### Verification

After switching production:

- `DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status` reports `Database schema is up to date!`.
- `GET /api/health` returns `200` (note: it does not touch the database; `app/api/health/route.ts` returns a static body).
- Sign in, open an invoice list and a recent invoice; compare invoice and payment counts with the pre-incident numbers recorded in Diagnosis.
- `curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/uptime"` returns `200`, and a new `UptimeCheck` row appears.
- Cron Jobs page shows `200` for the reminder routes after you re-enable them.

---

## Verification: restore to staging

Use this for drills and as step 3 of any real restore. It proves the backup is usable and that it matches the repository's migration history.

Prerequisites: a staging PostgreSQL target that is not production (`STAGING_DATABASE_URL` in the GitHub `staging` environment is the existing one; for a drill prefer a throwaway database), Node 24 and `npm ci` done in the repository.

```bash
export DATABASE_URL="$RESTORED_DATABASE_URL"   # the restored copy, NOT production

# 1. What does the restored database think it has applied?
npx prisma migrate status
```

Read the result:

| Output | Meaning | Action |
|---|---|---|
| `Database schema is up to date!` | Backup is current with this checkout's `prisma/migrations/` | Continue |
| `Following migration(s) have not yet been applied: ...` | The restore point predates those migrations (expected after restoring to an earlier time) | Apply forward with `npx prisma migrate deploy` (below) |
| `The migration ... failed` / drift warnings | A migration was interrupted, or the schema was changed outside Prisma (for example `db push`) | Stop. Inspect the `_prisma_migrations` table before using `prisma migrate resolve`; escalate |
| Migrations in the database that are missing locally | The restore point is *newer* than this checkout | Check out the matching code (the tag deployed at that time) |

If migrations are pending and you want to test the real upgrade path:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Then run the existing certification checks against the restored database, which does `migrate status` plus the staging gates (these need sandbox provider credentials and write data; run only against staging):

```bash
STAGING_DATABASE_URL="$RESTORED_DATABASE_URL" npm run release:certify
```

Finally, sanity-check data:

```sql
SELECT count(*) FROM "Invoice";
SELECT count(*) FROM "Payment";
SELECT max("createdAt") FROM "AuditLog";          -- should be at or just before the restore point
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL;  -- expect 0
```

Record the date, backup used, restore duration and result in the incident or drill notes.

> **Gap:** the drill has never been recorded as run. No RTO/RPO is stated, so "acceptable restore time" is undefined.

## Interaction with Prisma migrations

- **No down migrations.** Prisma does not generate them and this repository has none. Do not attempt to reverse a migration by hand in production ([DEPLOYMENT.md](../DEPLOYMENT.md#rollback)).
- **Forward-fix.** A bad migration is repaired by a new migration (`npx prisma migrate dev --name <fix>` locally, review the SQL, then `npx prisma migrate deploy` in staging first). The existing migrations are written expand-only (for example `20260814100000_invoice_reminder_deliveries` uses `IF NOT EXISTS` guards), which is what makes app-only rollback safe.
- **Restores carry `_prisma_migrations` with them.** A point-in-time restore returns the schema and its migration history to the same moment, so `migrate status` shows exactly which later migrations are pending. This is the reason to check status before deciding between "deploy matching older code" and "migrate forward".
- **Restore older than the code:** either run `npx prisma migrate deploy` to bring the restored schema forward (safe when migrations are additive and the data is intact), or redeploy the application version that matches the restored schema. Do not run the current code against an unmigrated database: a tag pushed without the manual migrate step already has this failure mode ([DEPLOYMENT.md](../DEPLOYMENT.md)).
- **Failed or interrupted migration:** `prisma migrate resolve --rolled-back <name>` or `--applied <name>` only update the history table; use them only after confirming by inspection what state the schema is in. Escalate before using them on production.
- **Never use** `prisma migrate reset` or `prisma db push` against production or a restored copy you intend to promote: the first drops all data and the second bypasses migration history.
- **Sequence for a risky migration:** take or confirm a fresh provider snapshot immediately before `npx prisma migrate deploy` in production, and note its identifier in the release notes. This is a recommendation; the release process does not currently require it.

> **Gap:** nothing automates or enforces a pre-migration snapshot, and `migrate deploy` is not wired into CI ([DEPLOYMENT.md](../DEPLOYMENT.md)).
