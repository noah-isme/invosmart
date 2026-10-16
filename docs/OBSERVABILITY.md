# Observability

What InvoSmart emits to understand its own health, where each signal lands, who is told, and what is missing. Written from the code on this branch; every claim names its file. Where something does not exist it says so in a **Gap** callout rather than implying it does.

Related: [DEPLOYMENT.md](./DEPLOYMENT.md#scheduled-jobs) (crons and post-deploy checks), [INTEGRATIONS.md](./INTEGRATIONS.md#observability) (provider contracts and env), [runbooks/reminder-delivery.md](./runbooks/reminder-delivery.md), [runbooks/backup-restore.md](./runbooks/backup-restore.md), [../SECURITY.md](../SECURITY.md).

## Signal map

| Signal | Emitted from | Where to look | Who is alerted |
|---|---|---|---|
| Unhandled client render error | `app/global-error.tsx` calls `Sentry.captureException` | Sentry project | Nobody by code. Alert rules live in Sentry's UI and are not in the repository |
| Client / server SDK errors and traces | `sentry.client.config.ts`, `sentry.server.config.ts`, `instrumentation.ts` (traces sampled at 0.1 / 0.1 / 0.2) | Sentry project, release `invo-smart@<version>` (`lib/release.ts`) | Same as above |
| Route spans | `withSpan` in `lib/tracing.ts` (used by 9 route files), adds an `x-trace-id` response header | Sentry traces | None |
| Web vitals and navigation timing | `lib/rum.ts` -> `trackEvent("web_vital" / "navigation_timing")` -> PostHog (browser) | PostHog events `web_vital`, `navigation_timing` | None |
| Product and AI server events | `captureServerEvent` (`lib/server-telemetry.ts`): `invoice_created`, `invoice_updated`, `invoice_paid`, `invoice_deleted`, `invoice_pdf_generated`, `ai_*`, `ai_policy_violation` | PostHog events | None |
| Uptime of monitored URLs | `/api/cron/uptime` -> `runUptimeChecks` (`lib/monitoring/uptime.ts`) every 5 min | `UptimeCheck` table; `/app/admin/uptime`; `GET /api/admin/uptime` | Slack and/or Discord, if `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` are set |
| Cron failures | HTTP status of each cron route; `console.error` lines | Vercel **Cron Jobs** page and runtime logs | Nobody by code |
| AI auto-action created / reverted | `lib/ai/approval-gates.ts` -> `dispatchWebhookAlert` | `AiAutoAction` rows, `/app/admin/auto-actions`; Slack / Discord | Slack and/or Discord, if configured |
| AI auto-action, recovery, rollback audit | `logAuditEvent` in `lib/ai/approval-gates.ts`, `lib/ai/recoveryAgent.ts` | `AuditLog`; `/app/admin/audit-logs` | Nobody |
| Invoice, client, auth, workspace, API-key, payment-webhook audit | `logAuditEvent` in the routes listed under [Audit logs](#audit-logs) | `AuditLog` | Nobody |
| Reminder delivery state changes | `auditDelivery` in `lib/team/reminder-delivery.ts` -> `AuditLog` (`INVOICE_REMINDER_*`) | `AuditLog`; `InvoiceReminderDelivery` rows | Nobody |
| Invoice email delivery events (delivered, bounced, complained...) | `app/api/webhooks/resend/route.ts` -> `AuditLog` (`INVOICE_EMAIL_*`) | `AuditLog`; `Invoice.emailLog` | Nobody |
| Platform admin misconfiguration | `warnAboutAdminConfig` (`lib/devtools/access.ts`), called from `instrumentation.ts` `register()` | Runtime logs (`[security] ...`) | Nobody |
| Liveness | `GET /api/health` returns `{status:"ok"}` | Uptime check, manual `curl` | See Uptime row |

> **Gap:** there is no on-call, paging or incident tooling in the repository. Slack/Discord webhooks are the only outbound alert path in code, and they cover only uptime and AI auto-actions. Everything marked "Nobody" depends on someone looking.

## Sentry

- **Files:** `sentry.client.config.ts`, `sentry.server.config.ts`, `instrumentation.ts`, `next.config.ts` (wrapped with `withSentryConfig`), `app/global-error.tsx`, `lib/tracing.ts`.
- **Env** (see [.env.example](../.env.example)): `SENTRY_DSN` (server), `NEXT_PUBLIC_SENTRY_DSN` (browser), `NEXT_PUBLIC_SENTRY_ENV` / `SENTRY_ENV` (environment name; default `NODE_ENV`), `ENABLE_TELEMETRY` and `NEXT_PUBLIC_ENABLE_TELEMETRY` (set `false` to disable). With no DSN, `enabled` is `false` and nothing is sent. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG` are read by the AI optimizer (`lib/ai/optimizer.ts`) to pull issue metrics, not by the SDK.
- **Release tag:** `invo-smart@<NEXT_PUBLIC_APP_VERSION>` (`lib/release.ts`, default `v1.0.0`). Check "the Sentry release for new errors" after each deploy ([DEPLOYMENT.md](./DEPLOYMENT.md#after-every-production-deploy)).
- **Sampling:** traces 0.1 in the client and server configs, 0.2 in `instrumentation.ts`. Client config also sets `replaysSessionSampleRate` 0.05 and `replaysOnErrorSampleRate` 1.0.
- **PII posture.** No `sendDefaultPii` option, no `beforeSend` and no scrubbing are configured anywhere in the repository, so the SDK defaults apply (default PII collection is off in `@sentry/nextjs` 8.x, but request URLs, headers the SDK keeps, and error messages are still sent). Do not put secrets or customer data in thrown error messages. `captureException` is called explicitly in only one place (`app/global-error.tsx`).
- **CSP:** `connect-src` allows `https://*.ingest.sentry.io` (`lib/security/csp.ts`). A self-hosted or regional Sentry host needs a CSP change.

> **Gap:** `instrumentation.ts` calls `Sentry.init` itself and the two `sentry.*.config.ts` files also call it; whether the SDK ends up initialised once or twice per runtime was not verified. `instrumentation.ts` does not export `onRequestError`, so unhandled errors inside Next.js route handlers and server components are not reported through the Next.js request-error hook; only errors that reach the SDK's own instrumentation, plus `global-error.tsx`, are captured. There is no `app/error.tsx` segment boundary.
>
> **Gap:** replay sample rates are configured but no replay integration is added in `sentry.client.config.ts`, so session replay is probably inactive. Confirm in Sentry before relying on it.
>
> **Gap:** no source-map upload configuration (`org`, `project`, `authToken` options for `withSentryConfig`) is present in `next.config.ts`; stack traces may be minified.
>
> **Gap:** Sentry alert rules, ownership and the Sentry project name are not documented.

## PostHog

- **Browser:** `lib/telemetry.ts` (`initTelemetry`, `trackEvent`) using `posthog-js`; started by `components/telemetry/TelemetryProvider.tsx`, which also starts RUM. Pageviews are not auto-captured (`capture_pageview: false`); page leave is. Persistence is `localStorage+cookie`.
- **Server:** `lib/server-telemetry.ts` (`captureServerEvent`, `captureServerMetric`) with `posthog-node`, `flushAt: 1`, `flushInterval: 0`. Events carry `release` and `environment` and use `distinctId` `"system"` unless the caller passes one.
- **RUM:** `lib/rum.ts` reports CLS, FCP, LCP, TTFB and INP (FID fallback) plus navigation timing. Sampling per page load is `NEXT_PUBLIC_RUM_SAMPLE_RATE` (default `0.2`, clamped 0..1), overridable by `globalThis.__INVOSMART_RUM_RATE__` or `localStorage["invosmart:rum-sample-rate"]`. Bots (`/bot|crawler|spider|crawling/i`) are not sampled. Events include route, theme, viewport and connection information and the PostHog distinct id.
- **Env:** `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_API_KEY`, `POSTHOG_API_HOST`, `POSTHOG_PROJECT_ID`, `ENABLE_TELEMETRY`, `NEXT_PUBLIC_ENABLE_TELEMETRY`. `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID` also let the AI optimizer query PostHog metrics.
- **CSP:** only `https://app.posthog.com` is allowed; another host needs a change in `lib/security/csp.ts` ([INTEGRATIONS.md](./INTEGRATIONS.md#observability)).
- **PII posture:** server events include organization and invoice identifiers and AI metadata, not names or email addresses in the call sites reviewed (`app/api/invoices/route.ts`, `lib/team/reminder-delivery.ts`). RUM events include the PostHog distinct id. Any new event must follow the same rule.

> **Gap:** PostHog is the only consumer of web vitals. The `/api/dev/perf/summary` devtools endpoint builds its LCP/INP/FCP series with a deterministic generator (`generateTimeseries`), not from stored data, so it is not a monitoring source.
>
> **Gap:** `lib/team/reminder-delivery.ts` reports `invoice_reminder_delivery` through `trackEvent` (the browser SDK). Server-side capture from a cron run was not verified; use `AuditLog` for reminder health.
>
> **Gap:** no PostHog dashboards, alerts or event dictionary are in the repository.

## Uptime monitoring

- **Code:** `lib/monitoring/uptime.ts`, `app/api/cron/uptime/route.ts`, `app/api/admin/uptime/route.ts`, `app/app/admin/uptime/page.tsx`. Table `UptimeCheck`.
- **Schedule:** `*/5 * * * *` in `vercel.json`. Authenticated with `CRON_SECRET` (`lib/cron-auth.ts`).
- **Targets:** `UPTIME_MONITORED_ENDPOINTS` (comma-separated; relative paths are resolved against `NEXTAUTH_URL`, then `VERCEL_URL`), else `DEFAULT_ENDPOINTS`, which are `http://localhost:3000/api/health` and `http://localhost:3000/api/invoices`. Each is probed sequentially with `GET`, a 5 s timeout and user agent `InvoSmart-Uptime-Monitor/1.0`. Only HTTP `200` counts as `UP`.
- **Alerting:** on every `DOWN` result, `dispatchWebhookAlert` posts to `SLACK_WEBHOOK_URL` and `DISCORD_WEBHOOK_URL` if set, with `actionType: "UPTIME_ALERT"`. Delivery errors are caught and logged, never thrown.
- **Viewing:** admin page `/app/admin/uptime` and `GET /api/admin/uptime` (platform admins only, `isPlatformAdmin`); 24-hour availability and average latency per URL (`getUptime24hStats`).

> **Gap:** if `UPTIME_MONITORED_ENDPOINTS` is unset in production, the monitor probes `localhost:3000` from inside the serverless function, which will report `DOWN` (or fail) rather than test the real site. [DEPLOYMENT.md](./DEPLOYMENT.md#scheduled-jobs) says the defaults are built from `NEXTAUTH_URL`/`VERCEL_URL`, but that applies only to relative entries in the variable, not to `DEFAULT_ENDPOINTS`. Set `UPTIME_MONITORED_ENDPOINTS` (for example `/api/health`).
>
> **Gap:** `/api/health` returns a static body and does not touch the database, so it proves the function runs, not that PostgreSQL is reachable. The default `/api/invoices` target needs a session and will return non-200 to the monitor.
>
> **Gap:** the monitor runs inside the application it monitors (Vercel cron), so a total outage of the deployment or of Vercel crons also silences the alerts. There is no external probe.
>
> **Gap:** alerts fire on every failed check (every 5 minutes), with no de-duplication, no recovery notification, no consecutive-failure threshold and no retention/pruning of `UptimeCheck` rows.

## AI webhook alerts (Slack and Discord)

- **Code:** `lib/ai/webhooks.ts` (`dispatchWebhookAlert`, `formatSlackBlocks`, `formatDiscordEmbed`). Called from `lib/ai/approval-gates.ts` when an auto-action is created and when it is reverted (fire-and-forget with `.catch`), and from `lib/monitoring/uptime.ts`.
- **Env:** `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` (both optional; with neither set the function returns an empty result). `SLACK_WEBHOOK_URL` is also the default for `lib/team/slack.ts` when no webhook is supplied.
- **Behaviour:** a single POST per target, no retry, no timeout set on the `fetch`, errors captured into the return value only. Payload includes action type, organization id, status, reason and confidence.
- **Separate path:** workspace reminder Slack messages do not use these env vars; they use each workspace's encrypted endpoint (`WorkspaceNotificationEndpoint`, `lib/team/slack.ts`) and are covered in [runbooks/reminder-delivery.md](./runbooks/reminder-delivery.md).

> **Gap:** `dispatchWebhookAlert` never throws; it returns `{ slack?, discord? }` with `ok: false` and an error string. None of the callers (`lib/ai/approval-gates.ts`, `lib/monitoring/uptime.ts`) inspects that result, and their `.catch`/`try` blocks only run on a throw, so a dead or revoked webhook URL fails silently.

## Audit logs

- **Table:** `AuditLog` (`tenantId`, `userId`, `action`, `entity`, `entityId`, `details` JSON, `ipAddress`, `createdAt`; indexed on tenant, user, action, entity and time). Write path: `logAuditEvent` in `lib/audit/auditLogger.ts`.
- **Writers (call sites):** NextAuth login success, failure and logout (`server/auth.ts`); registration; invoices and clients (internal and `/api/v1`); invoice templates; invoice email sends and the Resend webhook; Stripe and Midtrans payment webhooks; workspaces, invitations, members, API keys; AI auto-actions, approval gates and recovery rollbacks; reminder deliveries.
- **Read paths:** `/app/admin/audit-logs` (platform admins only; `/app/admin/audit-log` re-exports it), `GET /api/admin/audit-logs` (scoped to the caller's workspace via `canReadWorkspace`; a `tenantId` outside the caller's workspace is refused) and `GET /api/admin/audit-log` (re-exports the previous one).
- **PII:** rows hold `userId`, `ipAddress` (from `x-forwarded-for` or `x-real-ip`, `getClientIp`) and free-form `details`. Treat the table as personal data for retention and access purposes ([../SECURITY.md](../SECURITY.md)).

> **Gap:** no retention or pruning policy for `AuditLog`, `UptimeCheck` or other event tables was found in code or docs.
>
> **Gap:** `logAuditEvent` is called with `void` (fire and forget) in most places, so a failed audit write is lost without a trace in the response.

## Structured logging

What exists: unstructured `console.error` / `console.warn` calls (about 59 in `app/` and `lib/` outside tests), usually with a bracketed prefix such as `[Cron Reminder Delivery GET]`, `[UptimeCheck]`, `[ResendWebhook]`, `[security]`. They go to Vercel runtime logs. Responses from `withSpan`-wrapped routes carry an `x-trace-id` header that matches the Sentry trace.

> **Gap:** there is no logging library (`pino`, `winston`) and no JSON log format, no request id or tenant id on log lines, no log levels beyond `error`/`warn`, and no documented log drain or retention. Searching incidents means grepping Vercel's log viewer by the prefixes above.
>
> **Gap:** `GET /api/health` is the only health endpoint; there is no readiness check, metrics endpoint or dependency check.

## Ownership and next steps (suggested, not implemented)

These close the largest gaps above, in order of value:

1. Set `UPTIME_MONITORED_ENDPOINTS` in production and add an external probe.
2. Add alert rules in Sentry and record them here; add `onRequestError` to `instrumentation.ts`.
3. Add a threshold and recovery message to uptime alerts.
4. Add a reminder-delivery health signal ([runbooks/reminder-delivery.md](./runbooks/reminder-delivery.md)).
5. Record backup and restore ownership ([runbooks/backup-restore.md](./runbooks/backup-restore.md)).
