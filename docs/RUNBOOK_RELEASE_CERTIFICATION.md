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

## Database and deployment

```bash
npm ci
npx prisma migrate deploy
npm run lint
npm run typecheck
npm test
npm run build
```

Record the migration name, commit SHA, Node version, database provider, and build artifact. Confirm that the scheduled uptime route is authenticated and that query-string secrets are rejected.

## Payment provider contract

For both Midtrans and Stripe, execute pending → authorized/settled, expiry, cancellation, full refund, partial refund, duplicate event replay, out-of-order events, and amount/currency mismatch. Verify stable attempt IDs, idempotency keys, signed webhook validation, and invoice/payment reconciliation after every transition.

## Email provider contract

Register the Resend webhook and verify signed `sent`, `delivered`, `delayed`, `failed`, `bounced`, and `complained` events. Confirm provider-event deduplication, bounded retry behavior, audit records, and that bounce/complaint states do not silently report success.

## Browser and device gate

Run the critical invoice → email → payment Playwright spec on Chromium and perform mobile viewport smoke checks for invoice creation, PDF, email, checkout, and payment status. Attach screenshots/traces for failures and keep the gate on Node 20 in CI.

## Exit criteria

The release is certified only when all commands pass, provider signatures and lifecycle evidence are attached, no duplicate payment/email side effects are observed, and unresolved failures have an owner and rollback plan.
