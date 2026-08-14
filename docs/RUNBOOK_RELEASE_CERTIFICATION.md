# v1.2.1 Release Certification

Run this checklist against a staging deployment on Node 20 with a real PostgreSQL database. Do not mark payment or email as production-ready from mocked unit tests alone.

## Local verification baseline (2026-08-13)

The implementation baseline is green before staging certification:

- `npm run lint` — passed with zero errors.
- `npm run typecheck` — passed.
- `npm test -- --reporter=dot` — 473 tests passed and 1 skipped.
- `npm run build` — passed; all 86 static pages generated.
- `npx prisma validate` and `npx prisma generate` — passed.

These checks establish code-level readiness only. Provider signatures, database
migration rehearsal, and browser/device evidence still require staging. Builds
without a Sentry auth token emit upload warnings but remain valid; configure the
token in release CI when source-map upload is required.

## Certification command and CI behavior

The reusable preflight is `scripts/release-certification.mjs`:

```bash
# Safe for pull requests and ordinary CI; no provider or database secrets are read.
npm run release:check

# Secret-backed staging certification. Inject values from the staging secret
# manager first; do not commit a .env.staging file or paste values into evidence.
npm run release:certify
```

`release:check` validates Node 20, the critical package scripts and files, and
the payment lifecycle migration while deliberately skipping database and
provider checks. `release:certify` requires PostgreSQL `DATABASE_URL`, HTTPS
`NEXTAUTH_URL`, application/cron secrets, Midtrans, Stripe, and Resend settings;
checks `prisma migrate status`; and runs Prisma validation, lint, typecheck,
Vitest, production build, and the invoice-delivery/payment Chromium contract.
Use `npm run release:certify -- --allow-http` only for a local rehearsal.

GitHub Actions runs the secret-free preflight on pull requests, `main`, and
version tags. The `workflow_dispatch` → `Run staging certification` input is the
only path that uses the protected `staging` environment and its `STAGING_*`
secrets. This keeps unavailable staging credentials from blocking ordinary CI.
Each run uploads `QA-report/` and `test-results/` as evidence.

## Database and deployment

```bash
npm ci
npx prisma migrate deploy
npm run lint
npm run typecheck
npm test
npm run build
```

For staging, run `npm run release:certify` after injecting the protected
environment values. It must report no pending or failed migrations. Record the
migration names applied, commit SHA, Node version, database provider/version,
Prisma output, and build artifact. Confirm that the scheduled uptime route is
authenticated and that query-string secrets are rejected:

```bash
curl -i "$STAGING_URL/api/cron/uptime?secret=$CRON_SECRET"  # must be 401
curl -i -H "Authorization: Bearer $CRON_SECRET" "$STAGING_URL/api/cron/uptime"  # must not be 401
```

Never include the URL, bearer token, database URL, or provider credentials in
screenshots, logs, or the release evidence bundle.

## Payment provider contract

Run the following matrix in each provider's staging/sandbox account and attach
request/response IDs (redacted), webhook event IDs, timestamps, and the final
invoice/payment state. A checked row is evidence, not merely a unit-test result:

| Scenario | Midtrans | Stripe | Evidence to attach |
| --- | --- | --- | --- |
| pending → authorized/settled | [ ] | [ ] | attempt ID, provider transaction/payment intent |
| expiry / cancellation | [ ] | [ ] | signed event ID and final attempt status |
| full refund | [ ] | [ ] | refund ID and cumulative refund amount |
| partial refund | [ ] | [ ] | refund ID, remaining refundable amount |
| duplicate event replay | [ ] | [ ] | same event twice; one state transition |
| out-of-order events | [ ] | [ ] | delivery order and monotonic final state |
| amount/currency mismatch | [ ] | [ ] | rejected event and unchanged ledger |

For every row verify stable attempt IDs, idempotency keys, signed webhook
validation, replay/out-of-order protection, expiry/failure/refund transitions,
and invoice/payment reconciliation. Record provider mode (sandbox or
production), account/merchant identifier suffix only, and the exact build SHA.

## Email provider contract

Register the Resend webhook for the staging deployment and verify signed
`sent`, `delivered`, `delayed`, `failed`, `bounced`, and `complained` events.
For each event attach the redacted provider event ID, signature-verification
result, resulting delivery status, retry count, and audit-log record. Replay at
least one event and confirm provider-event deduplication, bounded retry
behavior, and that bounce/complaint states do not silently report success.

## Browser and device gate

Run the critical invoice → email → payment Playwright spec on Chromium and
perform mobile viewport smoke checks for invoice creation, PDF, email,
checkout, and payment status. The automated Chromium evidence is produced by:

```bash
npx playwright install --with-deps chromium
npm run test:e2e -- test/e2e/invoice-delivery-payment.spec.ts
```

For mobile evidence, use the approved staging device runner or Chromium DevTools
mobile emulation at the supported phone viewport and save screenshots/traces
under `QA-report/mobile/`. Verify the following on both network states:

| Flow | Desktop Chromium | Mobile viewport | Offline/PWA evidence |
| --- | --- | --- | --- |
| invoice creation and detail | [ ] | [ ] | [ ] |
| PDF export | [ ] | [ ] | [ ] |
| invoice email handoff | [ ] | [ ] | [ ] |
| checkout and payment status | [ ] | [ ] | [ ] |

Attach screenshots/traces for failures, include browser/device/viewport and
build SHA in the evidence index, and keep all automated gates on Node 20 in CI.

## Customer API gate

For the v1.3 beta and v1.4 GA, apply the `20260814110000_api_keys` migration
after the workspace backfill rehearsal. Verify that API key secrets are shown
only at creation, digests are stored, and `OWNER`/`ADMIN` management cannot
cross workspace boundaries. Exercise the OpenAPI contract at
`/api/openapi.json` and the following API v1 matrix with a key created in one
workspace:

| Scenario | Expected result |
| --- | --- |
| list/detail invoice and client | `200`, workspace-scoped data only |
| missing, malformed, expired, or revoked key | `401` with request ID |
| missing read/write scope | `403` without data leakage |
| unknown resource from another workspace | `404` |
| cursor and limit validation | bounded `200` or stable `400` error |
| create without `Idempotency-Key` | `400` |
| same idempotency key and payload replay | one side effect and same response |
| same idempotency key with changed payload | `409` |
| rate-limit exhaustion | `429` with `Retry-After` and limit headers |

Record the API key prefix, request IDs, redacted response status, migration
state, and build SHA. Never attach raw keys, invoice contents, or authorization
headers to release evidence. Keep the v1 surface limited to invoices and
clients until provider and tenancy gates for broader resources are complete.

## Exit criteria

The release is certified only when all commands pass, the Prisma database is
current, every provider matrix row, browser/device row, and applicable API row
has evidence, no duplicate payment/email/API side effects are observed, and
unresolved failures have an owner and rollback plan. Store the redacted JSON preflight report from
`QA-report/release-certification.json` with the release artifacts.
