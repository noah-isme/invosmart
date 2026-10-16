# Security

This is the security baseline for InvoSmart: how users and API clients are
authenticated, how requests are protected, how secrets are handled, what
personal data the system holds, and what is written to the audit log. It
describes the shipped code; every section names the file that enforces it.
When this document and the code disagree, the code is the behaviour and this
document is the bug.

Related documents:

- [docs/WORKSPACE_RBAC.md](docs/WORKSPACE_RBAC.md): workspace roles, the permission matrix and the platform-admin model (canonical for authorization).
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): per-provider signature checks, retries and failure behaviour.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): environments, secrets per environment, release and rollback.
- [`.env.example`](.env.example): every configuration variable (canonical env reference).

## Reporting a vulnerability

Report vulnerabilities privately through a GitHub security advisory on
[noah-isme/invosmart](https://github.com/noah-isme/invosmart/security/advisories/new).
Do not open a public issue, pull request or discussion for a suspected
vulnerability, and do not include live credentials or customer data in the
report.

> **Open decision:** response-time targets and a disclosure window are not
> defined yet.

## Authentication

Configuration: `server/auth.ts` (NextAuth).

- **Sessions** are stateless JWTs (`session: { strategy: "jwt" }`), signed with
  `NEXTAUTH_SECRET`. There is no database session table; rotating
  `NEXTAUTH_SECRET` signs every user out.
- **Email and password** (Credentials provider): input is validated with
  `LoginSchema`, and passwords are hashed with bcrypt, cost 10 (`lib/hash.ts`,
  used by `app/api/auth/register/route.ts`). Registration is rate limited
  (`rateLimit(request, "auth")`). Registration does not verify email
  ownership, which is why platform-admin access is granted by user id, never
  by email (see below).
- **Google OAuth** is enabled only when `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` are both set. Sign-in fails closed unless Google
  asserts `email_verified: true`, and a Google login is refused when a password
  account already owns that email (`handleGoogleSignIn`). Error codes on
  `/auth/login?error=` are fixed strings; raw error messages never reach the
  URL.
- **Route protection**: `middleware.ts` requires a session token for `/app/*`.
  API routes check the session themselves.
- Login successes and failures are written to the audit log (see
  [Audit logging](#audit-logging)).

## Authorization

Workspace roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and the capability
matrix are defined in `lib/workspaces.ts` and documented in
[docs/WORKSPACE_RBAC.md](docs/WORKSPACE_RBAC.md), which is the canonical
reference.

Platform administrators (DevTools, global feature flags, uptime, global admin
APIs) are the user ids listed in `ADMIN_USER_IDS`, checked by
`isPlatformAdmin` in `lib/devtools/access.ts`. An empty list means nobody is a
platform admin outside `next dev`, where any signed-in user is treated as one
for convenience. `ADMIN_EMAILS` and `NEXT_PUBLIC_ADMIN_EMAILS` are ignored.
Workspace `OWNER`/`ADMIN` never grants platform-admin access.

`WORKSPACE_AUTH_MODE` controls the workspace rollout: `compat` falls back to
user-owned rows when membership is missing, while `enforce` fails closed. Run
production on `enforce` once the backfill is verified
([docs/WORKSPACE_RBAC.md](docs/WORKSPACE_RBAC.md#migration-sequence)).

## Request protection

### CSRF

Double-submit cookie, enforced in `middleware.ts` with helpers from
`lib/security/csrf.ts`:

- Applies to `POST`, `PUT`, `PATCH` and `DELETE` on `/api/*`. A request must
  send the `x-csrf-token` header with the same value as the CSRF cookie,
  compared in constant time; otherwise the response is `403`.
- The cookie is `__Host-csrf-token` in production (Secure, `Path=/`, no
  Domain) and `csrf-token-v2` elsewhere. It is readable by same-origin
  JavaScript by design (`lib/security/csrf-client.ts` echoes it), `SameSite=Lax`.
  The middleware issues it on any `/app/*` or `/api/*` response that lacks it.
- Exemptions:
  - `/api/auth/*` (NextAuth has its own CSRF token).
  - Signature-verified endpoints, exact path and `POST` only: the three
    signed provider webhooks `/api/payments/stripe/webhook`,
    `/api/payments/midtrans/notification`, `/api/webhooks/resend`, and the
    public share-link checkout `/api/share/checkout`, whose verified
    signature is the HMAC invoice share token in the request body. Any path
    added to this list must verify a signature before touching the database,
    fail closed when its secret is missing, and never read session cookies.
    The middleware does not issue the CSRF cookie on these responses.
  - `/api/v1/*` requests that carry `Authorization: Bearer inv_live_…` (API-key
    clients are not browser sessions).
  - Everything when `NODE_ENV=test`.

### Security headers and CSP

Set for every path in `next.config.ts`:

- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy: geolocation=()`.
- `Content-Security-Policy` from `buildContentSecurityPolicy()` in
  `lib/security/csp.ts`: `default-src 'self'`; scripts from self, PostHog and
  the Midtrans Snap host; `connect-src` to self, PostHog and Sentry ingest;
  `frame-src` self and the Snap host; `frame-ancestors 'none'`;
  `object-src 'none'`; `upgrade-insecure-requests`. The Midtrans host is
  sandbox or production depending on whether
  `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` starts with `SB-Mid`.
- The policy still allows `'unsafe-inline'` and `'unsafe-eval'` for scripts.

No `Strict-Transport-Security` header is set by the app. HTTPS is enforced
per route with `enforceHttps` (`lib/security.ts`), which returns `403` when
`x-forwarded-proto` is not `https` in production, and by the `/api/v1`
authorizer.

### Rate limiting

There are two limiters; neither is global.

| Limiter | Where | Limit | Store |
|---|---|---|---|
| `rateLimit(request, bucket)` in `lib/rate-limit.ts` | Selected session routes: auth register, invoices, clients, templates, export, PDF, AI routes, receipt scan, revenue insight; public `GET /api/health?db=1` (`health-db` bucket) | 10 requests per 60 s per client IP per bucket, `429` with `Retry-After` | Process memory, per serverless instance |
| `consumeApiRateLimit` in `lib/api-v1/rate-limit.ts` | Every `/api/v1/*` request, before key validation | 120 requests per 60 s per API key (or per IP when the key is missing or invalid), `429` with rate-limit headers | Upstash Redis fixed window; falls back to process memory when Redis is not configured |

Because the session limiter is in memory, the effective limit scales with the
number of warm instances.

### Customer API keys

Implemented in `lib/api-keys.ts` and `lib/api-v1/auth.ts`; documented for
clients in [docs/API.md](docs/API.md).

- Format `inv_live_<prefix>_<secret>`. Only the public prefix and a SHA-256
  hash of the secret are stored (`ApiKey.prefix`, `ApiKey.secretHash`); the
  full token is shown once at creation and compared in constant time.
- Scopes: `invoices:read`, `invoices:write`, `clients:read`, `clients:write`.
  New keys default to read-only.
- Keys belong to one workspace, can expire (`expiresAt`) and be revoked
  (`revokedAt`). Managing keys requires the `manage_workspace` capability.
- Requests must use HTTPS; a workspace id that does not match the key is `403`.

### Webhooks from providers

Each webhook verifies a signature over the raw body before any database work
and fails closed when its secret is missing. Details per provider, including
status codes and deduplication, are in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

| Endpoint | Verification | On bad signature |
|---|---|---|
| `/api/payments/stripe/webhook` | `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET` and the `stripe-signature` header | `400`; `503` when not configured |
| `/api/payments/midtrans/notification` | SHA-512 of `order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY` compared with `signature_key` (`verifyMidtransSignature`, `lib/payments/lifecycle.ts`) | `403` |
| `/api/webhooks/resend` | Standard Webhooks (svix) signature with `RESEND_WEBHOOK_SECRET` (`verifyResendWebhook`, `lib/email/resend.ts`) | `400` |

### Scheduled endpoints

`/api/cron/*` routes call `requireCronAuthorization` (`lib/cron-auth.ts`):
the only accepted credential is `Authorization: Bearer $CRON_SECRET`, compared
in constant time. A secret in the query string is ignored, so the request is
`401`. In production a missing `CRON_SECRET` returns `503`; outside production
the routes are open when it is unset.

### Public links

- Invoice share links are HMAC-SHA256 tokens over the invoice id and an expiry
  (default 7 days), keyed with `INVOICE_SHARE_SECRET`, falling back to
  `NEXTAUTH_SECRET` (`lib/invoice-delivery.ts`). Production refuses to issue
  links when neither is set.
- The share page can start a checkout through `POST /api/share/checkout`
  (`app/api/share/checkout/route.ts`). The token is the only credential: no
  session or cookie is read. Checks, in order: per-instance IP rate limit
  (`share-checkout` bucket, 10/min; a coarse first line only), a 4 KB body
  cap, schema validation, token verification (`503` when the share secret is
  missing in production; `404` for a missing, bad, expired or foreign token
  and for a missing invoice, so the route never reveals whether an invoice
  exists), provider configured, invoice payable (`SENT`/`UNPAID`/`OVERDUE`,
  else `409`), currency. A client `Idempotency-Key` header is ignored; the
  server derives the key from provider, invoice and a 30-second window, so
  concurrent requests from any instance collapse onto one `PaymentAttempt`
  and at most one new attempt per invoice and provider is created per
  window. A request in a later window reuses the active share attempt
  instead (never an attempt started from the app), so one payer never holds
  two payable checkouts; a Stripe session expires with its attempt. The
  response carries only the Stripe URL or the Snap token, never
  attempt ids or amounts. The `payment=…` query parameter on the share page
  is display-only; only signed provider webhooks mark an invoice `PAID`.
- Workspace invitations expire after 7 days (`lib/team/invitations.ts`).

### Federation

`lib/federation/bus.ts` and `lib/federation/protocol.ts`:

- Outbound events are signed with RSA-SHA256 when `FEDERATION_PRIVATE_KEY`
  is set, otherwise with HMAC-SHA256 using `FEDERATION_TOKEN_SECRET`.
  Ingest verifies with the sender's public key or the shared secret, and
  rejects unsigned events when neither is configured. `ed25519` appears in the
  protocol schema's algorithm enum but has no signing or verification code.
- Payloads can be encrypted for a recipient: AES-256-GCM with a random key,
  wrapped with the recipient's RSA public key (OAEP, SHA-256).
  `generateFederationKeyPair()` produces RSA-2048 PEM keys.
- `/api/federation/status` accepts a peer bearer token equal to
  `FEDERATION_TOKEN_SECRET` or a platform-admin session.
- `ENABLE_AI_FEDERATION=false` (or `0`) disables the bus.

## Secrets

All secrets come from environment variables; none are stored in the
repository. `.env.example` holds placeholders only. Configure production
values in the Vercel project settings and staging values in the GitHub
`staging` environment (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

| Secret | Protects | Effect of rotation |
|---|---|---|
| `NEXTAUTH_SECRET` | Session JWTs; fallback for share links | Signs everyone out; invalidates share links that used the fallback |
| `INVOICE_SHARE_SECRET` | Invoice share links | Outstanding share links stop working |
| `CRON_SECRET` | `/api/cron/*` | Update the Vercel cron configuration at the same time |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Checkout, webhook verification | Rotate in the Stripe dashboard first, then redeploy |
| `MIDTRANS_SERVER_KEY` | Snap API and webhook signatures | Same as above, in the Midtrans dashboard |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Email sending, webhook verification | Same as above, in Resend |
| `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` | AES-256-GCM encryption of workspace Slack webhook URLs (`lib/team/secrets.ts`) | No key versioning: existing ciphertexts cannot be decrypted with a new key, so every workspace must re-enter its Slack endpoint |
| `FEDERATION_TOKEN_SECRET`, `FEDERATION_PRIVATE_KEY` | Federation signatures and peer auth | Coordinate with every peer |
| `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SENTRY_AUTH_TOKEN`, `POSTHOG_API_KEY`, `UPSTASH_REDIS_REST_TOKEN` | Third-party access | Rotate at the provider |

`INVOSMART_E2E_PROVIDER_BASE_URL` is test-only. The app refuses to start with
it on Vercel or with live provider keys, and `release:certify` rejects it.

> **Open decision:** there is no rotation schedule, and
> `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY` has no key-versioning support, so
> rotating it is a breaking change for every workspace.

## Data privacy

### Personal data held

| Model | Personal data | Purpose |
|---|---|---|
| `User` | `name`, `email`, bcrypt `password` hash | Accounts and login |
| `Client` | `name`, `email`, `phone`, `address` | Invoice recipients |
| `Invoice` | `client` (name), `items`, `notes`, `emailLog` | Billing and delivery history |
| `WorkspaceInvitation` | invitee `email` | Team invitations |
| `AuditLog` | `userId`, `ipAddress`, `details` (login events include the email address) | Security and change audit |
| `ReceiptAuditLog` | `actor`, `meta` | Receipt verification history |
| `ExplanationLog` | `actor` (may be an email address) | AI decision explanations |
| `PaymentAttempt`, `PaymentEvent` | Provider payloads in `metadata` and `payload` | Payment reconciliation |
| `InvoiceReminderDelivery` | delivery `errorMessage` (may echo the recipient) | Reminder delivery state |

### Where personal data leaves the system

- **Resend**: recipient email address, invoice details and a signed payment
  link (`app/api/invoices/[id]/send-email/route.ts`, `lib/team/reminder-delivery.ts`).
- **Stripe and Midtrans**: invoice amount, currency and reference; the
  customer enters payment details on the provider's page, not in InvoSmart.
- **Workspace Slack endpoints**: reminder notifications to the URL each
  workspace configures (stored encrypted).
- **Platform Slack and Discord webhooks** (`SLACK_WEBHOOK_URL`,
  `DISCORD_WEBHOOK_URL`): AI auto-action and uptime alerts
  (`lib/ai/webhooks.ts`). These carry operational data, not customer records.
- **Federation peers**: aggregated metrics. `sanitizeMetadata`
  (`lib/federation/protocol.ts`) removes the keys `rawEvents`, `pii`,
  `secrets`, `authToken`, `accessToken` and `session` at any depth. It is a
  key denylist, so PII stored under any other key name is not removed.
- **Sentry**: error events (`sentry.*.config.ts`, `instrumentation.ts`).
  `sendDefaultPii` is not enabled and no user is attached to events.
- **PostHog**: product analytics; no `identify()` call with user details
  exists in the app code.
- **OpenAI or Gemini**: invoice text and receipt images sent to the AI
  routes (`/api/invoices/ai`, `/api/receipts/ai-scan`, `/api/ai/*`).

### Retention and deletion

The code has no retention job: audit logs, delivery records, payment events
and AI logs are kept indefinitely. Nothing exports or erases a user's data on
request, and there is no account-deletion endpoint.

> **Open decision:** retention periods per table (in particular `AuditLog`
> IP addresses, `PaymentEvent` payloads and delivery error messages), a
> deletion/export procedure for data-subject requests, and what federation
> peers may retain.

## Audit logging

`logAuditEvent()` in `lib/audit/auditLogger.ts` writes `AuditLog` rows with
`tenantId` (workspace), `userId`, `action`, `entity`, `entityId`, `details`
(JSON) and `ipAddress`. Writes never block the request: a failed write is
logged to the console and dropped. No code path updates or deletes audit rows.

Logged actions (`AuditAction`): invoice create, update, delete and automatic
overdue; client create, update and delete; register, login success, login
failure and logout; AI auto-actions, auto-reverts and recovery rollbacks;
invoice email accepted, delivered, delayed, failed, bounced, complained and
suppressed. Payment webhooks log received, refunded,
duplicate-payment-refund-required and manual-review events as
`INVOICE_UPDATE` entries.

Receipt verification has its own trail in `ReceiptAuditLog`
(`lib/receipts/service.ts`).

**Who can read it**: `GET /api/admin/audit-logs` (alias `/api/admin/audit-log`)
returns the rows of the caller's current workspace. It requires
`canManageWorkspace` (the `manage_workspace` permission), so only `OWNER` and
`ADMIN` can read the workspace's audit log, which includes other members'
login events and IP addresses; `MEMBER` and `VIEWER` get `403`. Without a
workspace (the `LEGACY` compatibility context), callers see only their own
rows. The `/app/admin/audit-logs` page is separate: it is platform-admin only
and lists every tenant.
