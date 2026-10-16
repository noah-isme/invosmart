# External integrations

One section per external system InvoSmart talks to: what it is for, where the
code is, which variables configure it, how requests are authenticated, how
duplicates and failures are handled, and how it behaves when not configured.
Variables are described in [`.env.example`](../.env.example); security rules
that apply across providers are in [../SECURITY.md](../SECURITY.md).

The sandbox evidence required before a release (payment and email contract
matrices) is in
[runbooks/release-certification.md](runbooks/release-certification.md#payment-provider-contract),
not repeated here.

## Summary

| System | Direction | Required in production | If not configured |
|---|---|---|---|
| Stripe | Out (checkout) + in (webhook) | If Stripe checkout is offered | Checkout and webhook return `503` |
| Midtrans | Out (Snap) + in (notification) | If Midtrans checkout is offered | Checkout fails with `500`; notifications fail the signature check (`403`) |
| Resend | Out (email) + in (webhook) | Yes, for invoice and reminder email | Sends fail at Resend; webhook returns `400` |
| Google OAuth | In (sign-in) | No | Google sign-in is not offered |
| Gemini / OpenAI | Out | For AI features | AI routes throw (no key) |
| Upstash Redis / Vercel KV | Out | Yes | Rate limits, idempotency, caches and the agent stream fall back to process memory |
| Sentry | Out | Recommended | No error reporting |
| PostHog | Out | Recommended | No analytics; optimizer gets no metrics |
| Slack | Out | No | Alerts and workspace notifications are skipped |
| Discord | Out | No | Alerts skipped |
| Federation peers | Out + in | No | Bus disabled or local only |

## Payments

Both payment providers share one lifecycle (`lib/payments/lifecycle.ts`,
`lib/payments/settlement.ts`, `lib/payments/money.ts`):

- Each checkout creates a `PaymentAttempt` keyed by
  `(provider, idempotencyKey)` and `(provider, providerOrderId)`.
- Each webhook is stored as a `PaymentEvent`, unique on
  `(provider, providerEventId)`, so a replayed event is detected and answered
  `200 { duplicate: true }` without a second state change.
- Webhooks check that amount and currency match the attempt
  (`verifyAmountAndCurrency`). On a mismatch they return `400` and change
  nothing.
- A payment that arrives for an invoice that is already settled creates no
  `Payment`. It is logged as `DUPLICATE_PAYMENT_REFUND_REQUIRED` in the audit
  log and needs a manual refund.
- A payment recorded for an invoice that was marked `PAID` without a
  `Payment` is flagged for manual review.
- Refunds update the attempt. A full refund moves the invoice back to
  `UNPAID`.
- Checkout routes require the workspace `write` capability; reading payment
  status requires `read` ([WORKSPACE_RBAC.md](WORKSPACE_RBAC.md)).
- A checkout can be started only for invoices in `SENT`, `UNPAID` or
  `OVERDUE`. `PAID` returns `409 { error: "Invoice is already paid" }` and
  `DRAFT` returns `409 { error: "Invoice is not payable" }`.

Checkout routes accept an optional `Idempotency-Key` header. Reusing a key
whose attempt is no longer active returns `409`. Without a header, the server
derives a key per invoice and provider, so a retried click returns the active
attempt instead of creating a second one.

### Public checkout from the share link

The invoice email links to `/share/<id>?token=…&action=pay`. The share page
offers a pay button and `POST /api/share/checkout` starts the checkout without
a session, authorised by the share token ([SECURITY.md](../SECURITY.md#public-links)).

- **Provider choice**: `IDR` invoices default to Midtrans, any other currency
  to Stripe; when only one provider is configured and can charge the
  currency, that one is used. The other configured provider is offered as a
  secondary button. With `action=pay` the default provider starts once on
  load.
- **Configured means**: Stripe `STRIPE_SECRET_KEY`; Midtrans
  `MIDTRANS_SERVER_KEY` and `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` (snap.js is
  loaded on the share page only when Midtrans is offered).
- **Idempotency**: the route ignores a client `Idempotency-Key` and uses
  `share:<provider>:<invoiceId>:<30-second window>`, so concurrent requests
  share one attempt. Any later request first reuses the active, unexpired
  attempt whose key starts with `share:<provider>:<invoiceId>:` (an attempt
  started from the app is never reused: its return URLs point into the app),
  so a reload after the window still gets the same checkout; a new attempt
  is created only once that one is no longer active. A request that finds
  the attempt still waiting for the provider gets `409 { retry: true }`; one
  whose window attempt failed at the provider gets
  `503 { retry: true }` with `Retry-After` until the next window. The page
  retries a `retry: true` answer after a second.
- **Return URLs**: Stripe `success_url`/`cancel_url` are the share URL plus
  `payment=success` or `payment=cancelled`, built from `NEXT_PUBLIC_APP_URL`,
  then `NEXTAUTH_URL`, then the request origin. Snap callbacks return to the
  share URL with `payment=success` or `payment=pending`. The parameter only
  shows a notice; the invoice becomes `PAID` through the signed webhooks
  below, like any other checkout.
- **Attribution**: the attempt metadata and the Stripe session metadata carry
  `source: share_checkout`; the Stripe `userId` metadata is the invoice owner.

### Stripe

- **Purpose**: card checkout through Stripe Checkout Sessions.
- **Code**:
  - `lib/payments/stripe.ts`: client, API version `2025-02-24.acacia`
  - `app/api/payments/stripe/create-session/route.ts`
  - `app/api/payments/stripe/webhook/route.ts`
- **Env**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- **Outbound**: the attempt's idempotency key is passed to
  `stripe.checkout.sessions.create` as Stripe's own idempotency key.
- **Webhook**: `POST /api/payments/stripe/webhook`. Register this URL in the
  Stripe dashboard. It is exempt from CSRF.
  - Verification: `stripe.webhooks.constructEvent` over the raw body with the
    `stripe-signature` header.
  - Handled events: `checkout.session.completed`,
    `checkout.session.async_payment_succeeded`,
    `checkout.session.async_payment_failed`, `checkout.session.expired`,
    `charge.refunded`. Other events get `200 { ignored: true }`.
  - Responses:

    | Status | When |
    |---|---|
    | `503` | Stripe is not configured |
    | `400` | Signature header missing, signature invalid, or amount/currency mismatch |
    | `404` | Unknown attempt or invoice |
    | `403` | Payment ownership mismatch |
    | `500` | Unexpected error; Stripe retries |
- **Not configured**: both routes return `503`.

### Midtrans

- **Purpose**: Indonesian payment methods through Snap.
- **Code**:
  - `lib/payments/midtrans.ts`: Snap client
  - `app/api/payments/midtrans/create/route.ts`
  - `app/api/payments/midtrans/notification/route.ts`
  - `lib/security/csp.ts`: Snap script and frame hosts
- **Env**: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`,
  `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`. A client key starting with `SB-Mid`
  selects the sandbox hosts; anything else selects production.
- **Webhook**: `POST /api/payments/midtrans/notification`. Set it as the
  notification URL in the Midtrans dashboard. It is exempt from CSRF.
  - Verification: SHA-512 of `order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY`
    compared in constant time with `signature_key` (`verifyMidtransSignature`).
    An empty server key always fails.
  - Event id: `notification_id` when present, otherwise a fingerprint of
    transaction id, order id and statuses (`createMidtransEventId`).
  - Unknown transaction statuses get `200 { ignored: true }` so Midtrans
    stops retrying.
  - Responses:

    | Status | When |
    |---|---|
    | `400` | Malformed payload, missing transaction id, or amount/currency mismatch |
    | `403` | Invalid signature |
    | `404` | Unknown attempt |
    | `500` | Unexpected error; Midtrans retries |
- **Not configured**: the create route has no explicit configuration check, so
  the Snap call fails and the route returns `500`. Notifications fail the
  signature check (`403`).

## Email: Resend

- **Purpose**: invoice emails with a signed payment link, and reminder emails.
- **Code**:
  - `lib/email/resend.ts`: client and webhook verification
  - `app/api/invoices/[id]/send-email/route.ts`
  - `lib/invoice-delivery.ts`: status model and retry policy
  - `lib/team/reminder-delivery.ts`
  - `app/api/webhooks/resend/route.ts`
- **Env**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (defaults to
  `onboarding@resend.dev`), `RESEND_WEBHOOK_SECRET`, and `NEXT_PUBLIC_APP_URL`
  for links.
- **Retries**:
  - Invoice email allows 3 retries after the first attempt, with delays of
    1 min, 5 min and 30 min. Only transient failures are retried (timeouts,
    network errors, HTTP 408, 409, 425, 429 and 5xx); validation and
    recipient errors are final (`classifyEmailFailure`).
  - Reminder deliveries retry after 5 min, 15 min, 1 h and 6 h.
- **Webhook**: `POST /api/webhooks/resend`. Register it in Resend for the
  delivery events. It is exempt from CSRF.
  - Verification: Standard Webhooks (svix) signature with
    `RESEND_WEBHOOK_SECRET`, using headers `svix-id`, `svix-timestamp` and
    `svix-signature` (`webhook-*` names are also accepted).
  - Deduplication: by provider event id.
  - Events update the invoice's delivery status and write an
    `INVOICE_EMAIL_*` audit entry.
  - Responses:

    | Status | When |
    |---|---|
    | `400` | Invalid signature, or the secret is missing |
    | `200` | Accepted, including unknown event types, unmatched emails and duplicates (shown in the response body) |
    | `500` | Processing failed; Resend retries |
- **Not configured**: there is no explicit check. With no `RESEND_API_KEY`,
  the client uses a placeholder key, sends are rejected by Resend and recorded
  as failed deliveries.

## Sign-in: Google OAuth

- **Code**: `server/auth.ts` (NextAuth Google provider).
- **Env**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, plus `NEXTAUTH_URL`.
  The redirect URI to register with Google is
  `${NEXTAUTH_URL}/api/auth/callback/google`.
- **Rules**:
  - Requires `email_verified: true`.
  - Refuses an email that already has a password account.
  - Creates a user and personal workspace on first sign-in.
- **Not configured**: the provider is not registered and only email/password
  sign-in is available.

## AI: Gemini and OpenAI

- **Code**: `lib/ai.ts`, used by `/api/invoices/ai`, `/api/receipts/ai-scan`,
  `/api/ai/invoice-insight`, `/api/ai/theme-suggest`, `/api/ai/explain` and
  `lib/ai/*`.
- **Env**: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `AI_REQUEST_TIMEOUT_MS`
  (optional, default 20000).
- **Selection and failover**: when `GEMINI_API_KEY` is set, calls go first to
  Gemini (`gemini-2.5-flash`, REST `generativelanguage.googleapis.com`).
  Otherwise they go to OpenAI (`gpt-4o-mini`). When **both** keys are set, a
  timeout, network error or HTTP 408/429/5xx from the primary is retried once
  on the other provider (a model of the primary is swapped for the other
  provider's default); 400/401/403/404 are not retried. With neither key set,
  creating the client throws. See ADR 012.
- **Limits**: the AI session routes use the in-memory rate limiter (10 per
  minute per IP per bucket). Each provider call is aborted after
  `AI_REQUEST_TIMEOUT_MS`, so a failed-over request can take up to twice that.

## Upstash Redis / Vercel KV

- **Code**:
  - `lib/api-v1/redis.ts`: `/api/v1` rate limits and idempotency keys
  - `lib/ai/orchestrator.ts`: agent event stream
  - `lib/ai/scaler.ts`
  - `lib/cache/theme-suggestions.ts`
- **Env**: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. The
  `/api/v1` client also accepts `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- **Timeouts**: the `/api/v1` client times out after 1 s and makes one retry,
  so requests degrade or return `503` instead of hanging.
- **Not configured**: every user falls back to process memory. For `/api/v1`
  that means rate limits and idempotency keys are per instance and do not hold
  across serverless instances (a warning is logged in production).

## Observability

### Sentry

- **Code**:
  - `sentry.server.config.ts` and `sentry.client.config.ts`: trace sample rate 0.1
  - `instrumentation.ts`: trace sample rate 0.2, disabled when `ENABLE_TELEMETRY=false`
- **Env**: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENV`,
  `NEXT_PUBLIC_SENTRY_ENV`.
- **Read API**: the AI optimizer reads issue metrics from the Sentry API
  (`lib/ai/optimizer.ts`) using `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG` and
  `SENTRY_PROJECT_SLUG`.

### PostHog

- **Code**:
  - Browser analytics, toggled by `NEXT_PUBLIC_ENABLE_TELEMETRY`
  - Server events in `lib/server-telemetry.ts`
- **Env**:
  - Server: `POSTHOG_API_KEY` (falls back to `NEXT_PUBLIC_POSTHOG_KEY`) and
    `POSTHOG_API_HOST` (falls back to `NEXT_PUBLIC_POSTHOG_HOST`, then
    `https://app.posthog.com`).
  - Browser: `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`.
- **Read API**: the AI optimizer queries PostHog (`lib/ai/optimizer.ts`) with
  `POSTHOG_API_KEY` and `POSTHOG_PROJECT_ID`.
- **CSP**: allows `https://app.posthog.com` only. A different PostHog host
  needs a matching change in `lib/security/csp.ts`.

## Notifications

### Slack

There are two separate uses:

1. **Workspace notifications.** Each workspace stores its own incoming-webhook
   URL, encrypted with `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` (AES-256-GCM,
   `lib/team/secrets.ts`).
   - Only `hooks.slack.com` and `hooks.slack-gov.com` URLs are accepted
     (`lib/team/slack.ts`).
   - Requests time out after 5 s. Up to 3 attempts with a 250 ms backoff, and
     `Retry-After` is honoured up to 30 s.
   - Reminder delivery sends one attempt per run and relies on the reminder
     retry schedule.
2. **Platform alerts.** `SLACK_WEBHOOK_URL` receives AI auto-action and uptime
   alerts as Block Kit messages (`lib/ai/webhooks.ts`). It is also the default
   target of the `lib/team/slack.ts` notifier when no URL is passed.
   - These alerts are a single attempt with no timeout.
   - Failures are logged and never block the caller.

### Discord

`DISCORD_WEBHOOK_URL` receives the same AI auto-action and uptime alerts as
embeds (`lib/ai/webhooks.ts`). They are a single attempt with no timeout.
Leave it unset to disable.

## Federation peers

- **Code**:
  - `lib/federation/bus.ts`, `lib/federation/protocol.ts`
  - `lib/ai/federationAgent.ts`
  - `app/api/federation/status/route.ts`
- **Env**:
  - `ENABLE_AI_FEDERATION`
  - `FEDERATION_TENANT_ID`, `FEDERATION_ENDPOINTS` (comma-separated peer base URLs)
  - `FEDERATION_TOKEN_SECRET`
  - `FEDERATION_PRIVATE_KEY`, `FEDERATION_PUBLIC_KEY`, `FEDERATION_KEY_ID`
- **Signing and encryption**:
  - Outbound events are signed with RSA-SHA256 (private key) or HMAC-SHA256
    (shared secret).
  - Payloads can be encrypted with AES-256-GCM, with the key wrapped by RSA-OAEP.
  - Metadata passes through `sanitizeMetadata` before leaving. See
    [../SECURITY.md](../SECURITY.md#federation) and
    [ai/federation.md](ai/federation.md).
- **Outbound requests**: events are `POST`ed to `<peer>/api/federation/events`
  with `Authorization: Bearer $FEDERATION_TOKEN_SECRET`. Status is read from
  `<peer>/api/federation/status`. Neither request has a timeout or retry.
- **Inbound**: this app serves `/api/federation/status` (peer bearer token or
  platform-admin session) but has **no** `/api/federation/events` route.
  Ingest happens in-process through `FederationBus.ingest`, so two InvoSmart
  deployments cannot exchange events over HTTP as the code stands.

## Sandbox and test setup

- **E2E**: Playwright runs against a loopback provider stub. See
  [E2E_TESTING.md](E2E_TESTING.md#providers-one-loopback-stub-and-two-seams).
  - Resend and OpenAI are redirected with `RESEND_BASE_URL` and
    `OPENAI_BASE_URL`.
  - Stripe and Midtrans are redirected with the test-only
    `INVOSMART_E2E_PROVIDER_BASE_URL` (`lib/payments/e2e-provider-base.ts`).
    It is refused on Vercel and with live keys.
  - Webhooks are forged with the real signature algorithms
    (`test/e2e/support/webhooks.ts`).
- **Staging**: use Stripe test keys, Midtrans `SB-Mid` keys and a Resend
  staging domain. Run the contract matrices in
  [runbooks/release-certification.md](runbooks/release-certification.md)
  before a release that touches payments or email.
