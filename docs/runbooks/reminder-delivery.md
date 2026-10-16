# Runbook: invoice reminder delivery

Operations guide for the invoice reminder pipeline: how reminders are created and sent, how to tell when they are not, and how to fix each failure mode. Everything below was checked against the code on this branch. File paths are given so you can re-verify.

Related: [DEPLOYMENT.md](../DEPLOYMENT.md#scheduled-jobs) (cron table), [DATABASE.md](../DATABASE.md) (schema), [backup-restore.md](./backup-restore.md) (if data was damaged), [OBSERVABILITY.md](../OBSERVABILITY.md) (where signals go).

## How the pipeline works

```
vercel.json cron (every 5 min)
 ├─ GET /api/cron/reminders          app/api/cron/reminders/route.ts
 │    for each enabled InvoiceReminderRule, for each invoice in SENT/UNPAID/OVERDUE
 │    with dueAt set: scheduledAt = dueAt + offsetDays.
 │    If scheduledAt is in the past but within the last 24 h, INSERT an
 │    InvoiceReminderOccurrence (unique occurrenceKey; duplicates are ignored).
 │
 └─ GET /api/cron/reminder-delivery  app/api/cron/reminder-delivery/route.ts
      dispatchReminderDeliveries({ limit })   lib/team/reminder-delivery.ts
      1. recoverStaleClaims: PROCESSING rows with claimedAt older than 10 min
         go back to RETRY (or FAILED if attempts >= 5).
      2. Load up to `limit` occurrences (default 50, clamped 1..250, oldest
         scheduledAt first) whose scheduledAt <= now and status is
         PENDING, RETRY or PROCESSING.
      3. For each occurrence, upsert one InvoiceReminderDelivery per channel
         in the rule's `channels` (EMAIL, SLACK).
      4. For each delivery: skip if the invoice is paid; otherwise atomically
         claim it (PENDING/RETRY -> PROCESSING, attempts + 1), call the
         provider, then write SENT / SKIPPED / RETRY / FAILED.
      5. Recompute the occurrence status from its deliveries.
```

Both cron routes call `requireCronAuthorization` (`lib/cron-auth.ts`). In production a missing `CRON_SECRET` returns `503`, a wrong or absent `Authorization: Bearer` header returns `401`, and a secret in the query string is never accepted.

### Delivery statuses

| Status | Meaning | Leaves the state by |
|---|---|---|
| `PENDING` | Created by the dispatcher, never attempted | Claim, then `PROCESSING` |
| `PROCESSING` | Claimed by a worker; `claimedAt` is set | Provider result, or lease expiry (10 min) back to `RETRY`/`FAILED` |
| `RETRY` | Failed with a retryable error; `nextAttemptAt` is set | Claim once `nextAttemptAt <= now` |
| `SENT` | Provider accepted the message (`providerRef` set). This is acceptance, not inbox delivery | Terminal |
| `FAILED` | Non-retryable error, or 5 attempts used (`retry_exhausted`) | Terminal |
| `SKIPPED` | Intentionally not sent: `paid_invoice`, `missing_recipient`, `not_configured`, `invalid_channel` | Terminal |

Retry schedule after a retryable failure: 5 min, 15 min, 1 h, 6 h (`REMINDER_RETRY_DELAYS_MS`). `MAX_REMINDER_DELIVERY_ATTEMPTS` is 5, so the fifth failure is `FAILED`.

Occurrence status (`InvoiceReminderOccurrence.status`, a plain string, not an enum) is derived: any active delivery gives `PENDING`/`RETRY`; otherwise any `FAILED` gives `FAILED`; else any `SENT` gives `SENT`; else `SKIPPED`. Note a mixed occurrence (one channel `SENT`, one `FAILED`) is `FAILED`.

### Error codes you will see in `errorCode`

| Code | Source | Retryable | Final status |
|---|---|---|---|
| `resend_http_<status>` / `resend_error` | `sendReminderEmail` | 408, 409, 425, 429, 5xx and timeout/network-style messages (`classifyEmailFailure`, `lib/invoice-delivery.ts`) | `RETRY`, else `FAILED` |
| `missing_recipient` | Client has no valid email | No | `SKIPPED` |
| `invalid_config` | Slack secret failed to decrypt | No | `FAILED` |
| `not_configured` | No enabled Slack endpoint for the workspace | No | `SKIPPED` |
| `http-error`, `timeout`, `network-error`, `invalid-url`, `invalid-config`, `not-configured`, `invalid-payload` | `sendSlackWebhook` (`lib/team/slack.ts`) | Per Slack result | `RETRY` or `FAILED` |
| `provider_exception` | Provider threw | Yes | `RETRY` |
| `claim_timeout` | Lease expired | Yes | `RETRY` |
| `retry_exhausted` | Attempts >= 5 | No | `FAILED` |
| `paid_invoice` | Invoice paid before send | No | `SKIPPED` |

## First look (read-only, always safe)

Run against the production database with a read-only role if you have one. Table and column names are quoted because Prisma creates them in mixed case.

```sql
-- 1. Delivery counts by status and channel.
SELECT "status", "channel", count(*) AS n, min("updatedAt") AS oldest_update
FROM "InvoiceReminderDelivery"
GROUP BY 1, 2 ORDER BY 1, 2;

-- 2. Anything that should have been picked up already.
SELECT "id", "channel", "status", "attempts", "nextAttemptAt", "claimedAt",
       "errorCode", "errorMessage"
FROM "InvoiceReminderDelivery"
WHERE ("status" = 'PROCESSING' AND ("claimedAt" IS NULL OR "claimedAt" < now() - interval '10 minutes'))
   OR ("status" IN ('PENDING','RETRY') AND coalesce("nextAttemptAt", "createdAt") < now() - interval '15 minutes')
ORDER BY "updatedAt" ASC LIMIT 50;

-- 3. Failures in the last 24 h grouped by cause.
SELECT "errorCode", "channel", count(*) AS n, max("updatedAt") AS last_seen
FROM "InvoiceReminderDelivery"
WHERE "status" = 'FAILED' AND "updatedAt" > now() - interval '24 hours'
GROUP BY 1, 2 ORDER BY n DESC;

-- 4. Occurrences with no delivery rows yet (cron 2 has not run, or is failing).
SELECT o."id", o."organizationId", o."scheduledAt", o."status"
FROM "InvoiceReminderOccurrence" o
LEFT JOIN "InvoiceReminderDelivery" d ON d."occurrenceId" = o."id"
WHERE d."id" IS NULL AND o."scheduledAt" < now() - interval '15 minutes'
ORDER BY o."scheduledAt" LIMIT 50;
```

> **Gap:** there is no admin page, metric or alert for reminder deliveries. The only views are the SQL above, Vercel's **Cron Jobs** page (status code per invocation), the `AuditLog` rows described below and Vercel runtime logs. See [OBSERVABILITY.md](../OBSERVABILITY.md).

Each delivery state change also writes an `AuditLog` row with `action` `INVOICE_REMINDER_SENT`, `_RETRY`, `_FAILED` or `_SKIPPED` and `entity = 'InvoiceReminderDelivery'` (`auditDelivery` in `lib/team/reminder-delivery.ts`). Platform admins can browse them at `/app/admin/audit-logs`.

```sql
SELECT "createdAt", "action", "tenantId", "entityId", "details"
FROM "AuditLog"
WHERE "entity" = 'InvoiceReminderDelivery' AND "createdAt" > now() - interval '24 hours'
ORDER BY "createdAt" DESC LIMIT 100;
```

> **Caution:** `GET /api/cron/reminder-delivery` and `/api/cron/reminders` are not dry runs. Calling them sends real emails and Slack messages and writes rows. Only call them by hand when a section below tells you to, and never against production to "just check".

---

## 1. Deliveries stuck in `PROCESSING`

**Symptom.** Rows in `InvoiceReminderDelivery` with `status = 'PROCESSING'` for longer than 10 minutes (query 2 above). Occurrences stay `PENDING`/`PROCESSING`.

**Impact.** Affected reminders are not sent. Normally this self-heals, so a persistent stuck row means the dispatcher is not running to completion.

**Diagnosis.**

1. Expected self-heal: every run of `/api/cron/reminder-delivery` first moves `PROCESSING` rows with `claimedAt` older than 10 minutes to `RETRY` with `errorCode = 'claim_timeout'` (or `FAILED`/`retry_exhausted` when `attempts >= 5`). If rows are only a few minutes old, wait one cron cycle (5 min).
2. If rows stay `PROCESSING` past 15 minutes, the recovery step is not running. Go to [section 3](#3-cron-not-firing). Check the Vercel **Cron Jobs** page for `500` on `/api/cron/reminder-delivery`; a `500` means the whole dispatch threw (typically a database error) and logged `[Cron Reminder Delivery GET] Error:` with the first 240 characters of the message.
3. Check for the one case the recovery query cannot match:
   ```sql
   SELECT "id", "attempts", "updatedAt" FROM "InvoiceReminderDelivery"
   WHERE "status" = 'PROCESSING' AND "claimedAt" IS NULL;
   ```
   `recoverStaleClaims` filters on `claimedAt < staleBefore`, and a `NULL` never matches. The code always sets `claimedAt` when it sets `PROCESSING`, so rows here come from manual edits or a partial restore.
4. A function timeout can also leave a row `PROCESSING` after the provider call succeeded, so the lease expiry will resend. For email that is covered by the idempotency key; for Slack it produces a duplicate message (see [section 4](#4-duplicate-sends)).

**Fix.**

- Normal case: nothing to do; the next successful run reclaims the row.
- Rows with `claimedAt IS NULL` (confirm with the owner first; this writes):
  ```sql
  BEGIN;
  UPDATE "InvoiceReminderDelivery"
  SET "status" = 'RETRY', "nextAttemptAt" = now(), "claimedAt" = NULL,
      "errorCode" = 'manual_unstick', "errorMessage" = 'Reset by operator'
  WHERE "status" = 'PROCESSING' AND "claimedAt" IS NULL AND "attempts" < 5;
  -- check the row count, then COMMIT; otherwise ROLLBACK;
  ```
- If the dispatcher itself is failing, fix the root cause (database connectivity, a deploy that is not migrated: see [DEPLOYMENT.md](../DEPLOYMENT.md), run `npx prisma migrate status`).

**Rollback.** The update above is reversible only by re-running with the old values; take the `SELECT` output of the affected rows before updating and keep it in the incident notes.

**Escalation.** If `PROCESSING` rows keep appearing while cron returns `200`, escalate to the backend owner: it implies runs are being killed mid-batch (Vercel function duration) and `limit` may need lowering.

**Verification.** Query 2 returns no rows after two cron cycles, and `GET /api/cron/reminder-delivery` responses in Vercel logs show `summary.claimed` > 0 followed by `sent` or `retried`.

---

## 2. Repeated `FAILED` deliveries

**Symptom.** Query 3 shows `FAILED` rows, or customers report missing reminders.

**Impact.** The reminder for that invoice/channel is lost permanently: `FAILED` is terminal and the occurrence is not rescanned. Because `/api/cron/reminders` only creates occurrences within 24 hours of `scheduledAt`, a failure that is fixed days later will not regenerate it.

First, read the cause:

```sql
SELECT d."id", d."channel", d."attempts", d."errorCode", d."errorMessage",
       o."organizationId", o."invoiceId", o."scheduledAt"
FROM "InvoiceReminderDelivery" d
JOIN "InvoiceReminderOccurrence" o ON o."id" = d."occurrenceId"
WHERE d."status" = 'FAILED'
ORDER BY d."updatedAt" DESC LIMIT 50;
```

### 2a. Email: Resend errors

| `errorCode` | Likely cause | Action |
|---|---|---|
| `resend_http_401` / `resend_http_403` | `RESEND_API_KEY` missing or wrong; sender domain not verified; `RESEND_FROM_EMAIL` unset. Note `lib/email/resend.ts` falls back to the placeholder key `re_test_placeholder`, and `sendReminderEmail` falls back to `onboarding@resend.dev` when `RESEND_FROM_EMAIL` is unset. | Check both variables in the Vercel project (they are not versioned with deployments). Verify the sending domain in the Resend dashboard |
| `resend_http_422` | Provider rejected the payload, for example an invalid recipient | Fix the client's email address; not retryable |
| `resend_http_429` | Provider rate limit | Retried automatically; if exhausted, check Resend usage limits |
| `resend_http_5xx`, `resend_error` with timeout text | Provider outage or network | Retried automatically (5 min, 15 min, 1 h, 6 h). Check the Resend status page |
| `SKIPPED` / `missing_recipient` (not a failure) | `client_rel.email` empty or invalid | Add an email to the client |

> **Gap:** `classifyEmailFailure` treats an error as retryable only on the status codes and message patterns listed above. An unrecognised provider error without a status code is `FAILED` on the first attempt. There is no alert when this happens.

> **Gap:** `SENT` means Resend accepted the message. The Resend webhook (`app/api/webhooks/resend/route.ts`) keys off the `invoice_id` tag and writes `INVOICE_EMAIL_*` audit events for invoice sends; reminder sends carry the same `invoice_id` tag plus `reminder_occurrence` and `reminder_attempt`, but nothing updates `InvoiceReminderDelivery` from bounce or complaint events. Verify bounces in the Resend dashboard.

### 2b. Slack: endpoint decrypt failure

**Signature.** `errorCode = 'invalid_config'`, `errorMessage = 'Slack notification endpoint configuration is invalid'`, `attempts = 1`, status `FAILED` immediately (non-retryable).

**Cause.** `decryptWorkspaceSecret` (`lib/team/secrets.ts`) threw. That happens when:

- `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` is missing, is not 64 hex characters or base64 of 32 bytes, or has been changed since the endpoint was saved (AES-256-GCM authentication then fails).
- `WorkspaceNotificationEndpoint.secretCiphertext` is not in the `v1:<iv>:<tag>:<ciphertext>` format.

The code does not distinguish these cases; all become `invalid_config`.

**Diagnosis (does not reveal the secret).**

```sql
SELECT "id", "organizationId", "type", "enabled", length("secretCiphertext") AS len,
       split_part("secretCiphertext", ':', 1) AS version, "updatedAt"
FROM "WorkspaceNotificationEndpoint" WHERE "type" = 'SLACK';
```

Version must be `v1` with four colon-separated parts. If format is right and every workspace fails, the key in the environment differs from the one used to encrypt: compare with the previous deployment's environment, or with whoever holds the old key.

**Fix.**

1. Restore the original key value in the Vercel environment and redeploy. Do not "rotate" this key without re-encrypting stored endpoints: there is no rotation or re-encryption script in the repository.
2. If the original key is lost, a workspace admin must re-enter the Slack webhook URL with `POST /api/workspaces/{id}/notifications` (`app/api/workspaces/[id]/notifications/route.ts`). It upserts on (workspace, type) and encrypts with the current key. The `PATCH .../{endpointId}` route only toggles `enabled`. It returns `503` if the encryption key is not configured.
3. Slack webhook hosts are restricted to `hooks.slack.com` and `hooks.slack-gov.com` (`lib/team/slack.ts`); `invalid-url` means the saved URL is on another host.

> **Gap:** no key-rotation tooling or runbook exists for `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY`.

### Re-driving `FAILED` rows

Terminal rows are not retried by code. Once the cause is fixed and the occurrence is recent enough that a late reminder is still useful, reset the rows (write; get owner approval first):

```sql
BEGIN;
-- 1. Capture before-state for the incident notes.
SELECT "id","status","attempts","errorCode" FROM "InvoiceReminderDelivery"
WHERE "id" IN ('<delivery_id_1>', '<delivery_id_2>');

UPDATE "InvoiceReminderDelivery"
SET "status" = 'RETRY', "attempts" = 0, "nextAttemptAt" = now(), "claimedAt" = NULL,
    "errorCode" = NULL, "errorMessage" = NULL
WHERE "id" IN ('<delivery_id_1>', '<delivery_id_2>') AND "status" = 'FAILED';

-- The dispatcher only scans occurrences in PENDING/RETRY/PROCESSING.
UPDATE "InvoiceReminderOccurrence" SET "status" = 'PENDING', "error" = NULL
WHERE "id" IN (SELECT "occurrenceId" FROM "InvoiceReminderDelivery"
               WHERE "id" IN ('<delivery_id_1>', '<delivery_id_2>'));
-- check row counts, then COMMIT; otherwise ROLLBACK;
```

The next cron run picks them up. A paid invoice will be `SKIPPED`/`paid_invoice`, not sent. Resend deduplicates on `reminder-delivery:v1:<occurrenceKey>:EMAIL`, so a re-drive of a message Resend already accepted will not produce a second email within Resend's idempotency window (see Resend's documentation for the window length). Slack has no such protection.

**Rollback.** Set the rows back to `FAILED` with the captured values. An already-sent message cannot be recalled.

**Escalation.** Resend: the account owner (provider support for domain or account suspension). Slack: the workspace admin who owns the webhook. Key loss: the engineer who owns the Vercel project environment.

**Verification.** After the next cron cycle the rows are `SENT` with a `providerRef`, query 3 shows no new `FAILED`, and `AuditLog` has `INVOICE_REMINDER_SENT` for those delivery ids.

---

## 3. Cron not firing

**Symptom.** No new deliveries or occurrences; `InvoiceReminderOccurrence` max(`createdAt`) is old although invoices are due; the Vercel **Cron Jobs** page shows no recent invocations or non-200 codes.

**Impact.** No reminders are created or sent. Missing occurrences are never backfilled beyond the 24 h window (`app/api/cron/reminders/route.ts`), so every hour of outage past 24 h loses reminders.

**Diagnosis.**

1. Confirm the schedule is deployed: `vercel.json` defines `/api/cron/uptime`, `/api/cron/reminders` and `/api/cron/reminder-delivery`, each `*/5 * * * *`. Vercel registers crons from the production deployment, so a deployment that omitted `vercel.json` or a project not on a plan that allows 5-minute crons will not run them (check Vercel's plan limits).
2. Check the Cron Jobs page status codes:
   - `503` with body `Cron secret is not configured`: `CRON_SECRET` is not set in the Vercel production environment. Set it and redeploy.
   - `401`: the secret Vercel sends does not match the app's `CRON_SECRET`, or something added the secret in a query string (rejected by design).
   - `500`: the route ran and threw; see Vercel runtime logs for `[Cron Reminder Delivery GET] Error:`.
   - No invocations at all: the cron is not registered; redeploy production and re-check.
3. Reproduce authentication only, against a route that is safe to call. `/api/cron/uptime` is the safest (it only probes URLs and stores `UptimeCheck` rows). This is the same check as step 2 of "After every production deploy" in [DEPLOYMENT.md](../DEPLOYMENT.md#after-every-production-deploy):
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/uptime"
   ```
   Expected `200`. Do not use the reminder routes for this.
4. Is the data side fine? Check enabled rules and candidate invoices:
   ```sql
   SELECT count(*) FILTER (WHERE "enabled") AS enabled_rules, count(*) AS rules
   FROM "InvoiceReminderRule";
   SELECT max("createdAt") AS last_occurrence FROM "InvoiceReminderOccurrence";
   ```
   Zero enabled rules or no invoices in `SENT`/`UNPAID`/`OVERDUE` with a `dueAt` is not an outage.

**Fix.** Set `CRON_SECRET` (and keep it identical between Vercel's cron configuration and the app, which are the same environment variable), redeploy production, then wait one 5-minute cycle. If the outage exceeded 24 h, reminders for that gap were skipped; decide with the business owner whether to notify customers manually.

**Rollback.** If a redeploy made things worse, promote the previous deployment in Vercel ([DEPLOYMENT.md](../DEPLOYMENT.md#rollback)). Environment variables are not versioned with deployments, so revert any env change separately.

**Escalation.** Vercel support for cron registration problems; the project owner for plan limits.

**Verification.** Vercel Cron Jobs page shows `200` for both reminder routes on consecutive cycles, `last_occurrence` advances when an invoice crosses its reminder time, and query 2 returns no rows.

---

## 4. Duplicate sends

**Symptom.** A customer received the same reminder twice.

**What the code guarantees.**

- One occurrence per (workspace, invoice, rule, `dueAt`, `offsetDays`): unique `occurrenceKey`.
- One delivery per (occurrence, channel): unique index `invoice_reminder_delivery_occurrence_channel`.
- Claiming is an atomic `updateMany` guarded by status and `nextAttemptAt`, so two overlapping cron runs cannot both claim a delivery.
- Email carries Resend idempotency key `reminder-delivery:v1:<occurrenceKey>:EMAIL`.
- Slack has **no** provider idempotency (`sendReminderSlack` posts once with `maxAttempts: 1`); delivery is at-least-once.

**Diagnosis.**

```sql
-- Same invoice reminded more than once in a day, by distinct occurrences.
SELECT o."invoiceId", d."channel", date_trunc('day', d."sentAt") AS day,
       count(*) AS sends, array_agg(o."occurrenceKey") AS occurrence_keys,
       array_agg(o."ruleId") AS rules
FROM "InvoiceReminderDelivery" d
JOIN "InvoiceReminderOccurrence" o ON o."id" = d."occurrenceId"
WHERE d."status" = 'SENT' AND d."sentAt" > now() - interval '7 days'
GROUP BY 1, 2, 3 HAVING count(*) > 1
ORDER BY sends DESC LIMIT 50;
```

Interpret:

- **Different `occurrenceKey`s with different `ruleId`s:** the workspace has several enabled rules (for example offsets 0 and 1) that fire close together. By design, not a bug. Review `/api/workspaces/{id}/reminder-rules`.
- **Different `occurrenceKey`s, same rule:** the invoice's `dueAt` changed. The key includes `dueAt`, so a new date yields a new occurrence.
- **Same occurrence, `EMAIL`, two customer emails:** check the `providerRef`s in `AuditLog` (`INVOICE_REMINDER_SENT` details). Two different Resend ids would contradict the idempotency guarantee; keep the evidence and escalate to the backend owner. Also check the customer did not receive the separate invoice email (`/api/invoices/{id}/send-email`), which is a different message.
- **Same occurrence, `SLACK`, two messages:** a lease expiry (`claim_timeout`, see section 1) after a successful post, or the provider call succeeded and the database write then failed. Expected at-least-once behaviour.
  ```sql
  SELECT "createdAt", "action", "details" FROM "AuditLog"
  WHERE "entityId" = '<delivery_id>' ORDER BY "createdAt";
  ```
  An `INVOICE_REMINDER_RETRY` with `errorCode: 'provider_exception'` or a `claim_timeout` before the `SENT` is the signature.

**Fix.** Disable the noisy rule with `PATCH /api/workspaces/{id}/reminder-rules/{ruleId}` (set `enabled` to false), or lower the dispatch `limit` if function timeouts cause lease expiries. No data repair is needed; a sent message cannot be recalled.

**Rollback.** Re-enable the rule.

**Escalation.** Backend owner for any same-occurrence duplicate email (it would indicate an idempotency failure).

**Verification.** The duplicate query returns no new rows for the next due cycle.

---

## Manual trigger (use sparingly)

Only when a section above says to, with the owner informed:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" "$PROD_URL/api/cron/reminder-delivery?limit=10"
```

The response is `{ "success": true, "summary": { scanned, materialized, claimed, sent, retried, failed, skipped, suppressed } }`. A small `limit` caps blast radius. Both the `GET` and `POST` verbs are accepted on this route; `/api/cron/reminders` is `GET` only.

## Known gaps (summary)

> **Gap:** no alert, dashboard or admin UI for reminder delivery health.
>
> **Gap:** no automatic re-drive of `FAILED` rows or catch-up of occurrences older than 24 h.
>
> **Gap:** no bounce/complaint feedback into `InvoiceReminderDelivery`.
>
> **Gap:** no rotation procedure for `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY`.
>
> **Gap:** `auditDelivery` emits a `invoice_reminder_delivery` PostHog event through `trackEvent` in `lib/telemetry.ts`, which is the browser SDK (`posthog-js`) initialised by `components/telemetry/TelemetryProvider.tsx`. Whether it captures anything from a server-side cron run was not verified; do not rely on PostHog for reminder health. The `AuditLog` rows are the reliable record.
