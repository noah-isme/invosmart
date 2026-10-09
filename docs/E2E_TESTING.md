# End-to-end testing

This guide covers the Playwright suite under `test/e2e/`, the Vitest DB integration layer under `test/integration/db/`, and the checks around them. The design rationale and the scenario catalogue are in `.plans/e2e-scenarios.md`.

## Quick start

Requirements: Node 24 (`.nvmrc`; Node 26 breaks jsdom), network access for the build (`next/font` fetches Google Fonts), and Chromium for Playwright. No `.env`, database, Docker or provider account is needed.

```bash
npm ci
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder npx prisma generate
npx playwright install chromium        # add --with-deps on a fresh Linux machine
npm run e2e:build                      # ~3 min; next build with the e2e NEXT_PUBLIC_* values
npm run test:e2e:smoke                 # @smoke tier, ~25 s
```

| Command | What it runs |
|---|---|
| `npm run e2e:build` | `next build` with the e2e `NEXT_PUBLIC_*` values; writes the stamp `.next/e2e-build.json` |
| `npm run test:e2e:smoke` | `@smoke` scenarios (the PR gate) |
| `npm run test:e2e` | Full local tier: everything except `@staging` |
| `npm run test:e2e:contract` | No-DB contract gate (`E2E_CONTRACT_ONLY=1`, app server only, `specs/contracts/**`) |
| `npm run test:e2e:staging` | `@staging` specs against `PLAYWRIGHT_BASE_URL` (user-run, see Tiers) |
| `npm run test:integration` | Vitest DB integration layer (`vitest.integration.config.mts`, own PGlite) |
| `npm run test:stub` | `node:test` suite for the provider stub |
| `npm run test:db-support` | `node:test` suites for the DB guard, schema helper and the pglite-server filter |
| `npm run typecheck:e2e` | `tsc` over `test/e2e/**` and `playwright.config.ts` (the root `tsconfig.json` excludes `test/**`) |
| `node scripts/e2e-coverage-check.mjs` | Route coverage gate (see Coverage check) |
| `npm run e2e:db:probe` | PGlite connection probes (needs `npm run e2e:db` running) |
| `npm run e2e:report` | Open `QA-report/html` |

A plain `npm run build` replaces `.next` and deletes the stamp; run `npm run e2e:build` again before the next Playwright run. The config refuses to start with a missing or stale stamp (it is skipped for `--list`, staging runs and the contract gate).

## Architecture

```
Playwright (workers: 1)
  webServer 1  provider stub        node test/e2e/support/provider-stub/server.mjs   127.0.0.1:E2E_STUB_PORT (4010)
  webServer 2  database             node test/e2e/support/db/serve.mjs               127.0.0.1:E2E_DB_PORT (54329), /ready on +1
  webServer 3  app                  npm run start -- -p E2E_APP_PORT                 http://localhost:E2E_APP_PORT (3000)
  projects     setup (personas) -> chromium (browser specs), api (request-only specs)
```

### Database: PGlite behind a filtered pglite-server

- `serve.mjs` starts `test/e2e/support/db/pglite-server.mjs` (`-h 127.0.0.1 -m 1 -d memory://`), waits for its listening line, applies the schema with `applySchema()` (`test/e2e/support/db/schema.mjs`, `E2E_SCHEMA_MODE=push` by default), seeds the platform admin, and only then answers `GET /ready`. The app starts after that, so it never sees an empty database. The server log is copied to `QA-report/pglite-server.log`.
- `pglite-server.mjs` runs the unmodified `PGLiteSocketServer` over a PGlite whose `execProtocolRawStream` is wrapped. Root cause (electric-sql/pglite#958): PGlite 0.5.8 / pglite-socket 0.2.11 answers a failing extended-protocol message with `E` plus a premature ReadyForQuery `Z`, then the regular `Z` for `Sync`. Prisma treats the duplicate `Z` as a protocol violation and drops the connection, so the next 1-4 queries fail; any app path that catches a `P2002` and continues was affected. The filter drops the trailing 6-byte `Z` only for a single non-startup, non-`Q`/`S`/`F` message whose reply also contains an `E`; everything else passes through byte for byte.
- Forward-compat guard: unexpected framing, more than one message, no `E` or no trailing `Z` all degrade to passthrough, so a fixed upstream runs through the wrapper unchanged. Remove the filter once upstream ships the fix and `test/e2e/support/db/pglite-server.test.mjs` passes against the stock CLI. Other checks: `test/integration/db/pglite-errors.test.ts`, `test/e2e/specs/support/db-errors.spec.ts` (exactly one `Client connected` after `ready`).
- Shared-session caveat: PGlite is a single backend, so every socket client shares one session, including Prisma's named prepared statements (`s0`, `s1`, ...). A second Prisma client collides with the first one's statements, which is why `-m 2` fails. For the same reason the platform-admin seed runs `DEALLOCATE ALL` before it disconnects; otherwise the app's first write fails with `42P05`.

### The app is the only database client

While the app runs, nothing else opens a Prisma client: the Playwright process creates and reads data only through the app's HTTP API. Evidence from the spike (`npm run e2e:db:probe`, PGlite 0.5.8, Node 24.21):

| Probe | Setup | Result |
|---|---|---|
| `single` | one client, `-m 1`, `connection_limit=1`, 45 concurrent jobs (5 interactive transactions, 30 reads, 10 writes) | `failed 0`, rollback correct (~320 ms) |
| `two-clients` | app + test runner, `-m 1` | second connection refused (`Can't reach database server`), 20 of 40 jobs failed |
| two clients, `-m 2` | each `connection_limit=1`, 160 jobs | passed 1 of 3 runs; 2 of 3 failed with `42P05 prepared statement "s0" already exists` |
| one client, `-m 4` | `connection_limit=4` | 3 of 45 failed (electric-sql/pglite#1046 interleaving) |

The probe's exit code follows `single` only; `two-clients` documents the constraint. A serializing proxy cannot fix the `-m 2` failure because it is shared session state, not scheduling. Keep `-m 1` and `connection_limit=1`.

DB-level setup and assertions that have no API (backdated invitation expiry or `nextAttemptAt`, digest-not-raw and ciphertext checks, `PaymentEvent` counts, competing webhooks) live in `test/integration/db/`. That layer starts its own pglite-server in `globalSetup` and calls route handlers or `lib/` functions in-process with no app running, so the test is the single client.

### Test data: API-driven factories

`test/e2e/support/api-factories.ts` creates everything through the app (`registerAndLogin`, `createWorkspace`, `switchWorkspace`, `createClient`, `createInvoice`, `createTemplate`, `createApiKey`, `createReminderRule`, `inviteMember`/`acceptInvitation`, `createSlackEndpoint`, `createReceipt`, `createExperiment`, ...). Paid invoices come from forged, correctly signed provider webhooks (`payInvoiceViaMidtrans`, `payInvoiceViaStripe`), which is the real settlement path. There is no test-only seed route in app code.

Every test makes its own users and workspaces with unique emails (`e2e+<spec>+<random>@invosmart.test`); the in-memory database is thrown away after the run. Every factory request and every browser context gets a fresh `x-forwarded-for`, so the process-local rate limiters never leak between tests; the `guards` fixture fails a test on any unexpected 429 unless it carries the `expects-429` annotation.

### Personas and the platform admin

`test/e2e/setup/personas.setup.ts` registers `owner`, `admin`, `member` and `viewer` (one shared "E2E RBAC workspace") and writes their storage states to `test/e2e/.auth/` (gitignored). Platform admin is decided by `ADMIN_USER_IDS` (session user id; `ADMIN_EMAILS` is ignored by the app). Because the app reads `ADMIN_USER_IDS` at start, `test/e2e/support/db/seed-platform-admin.mjs` pre-creates the `platformAdmin` user with the fixed id `E2E_PLATFORM_ADMIN_ID` (`e2e-platform-admin`) before `/ready`, and the setup project only logs it in. The `chromium` project's default storage state is `owner`; unauthenticated specs use `test.use({ storageState: { cookies: [], origins: [] } })`.

### Providers: one loopback stub and two seams

- Resend and OpenAI are redirected by their own env (`RESEND_BASE_URL`, `OPENAI_BASE_URL`) to the stub (`/resend`, `/openai/v1`). PostHog metrics go to `/posthog`. Upstash, Sentry, Slack, Discord, Google OAuth and Gemini are blanked.
- Stripe and Midtrans have no env redirect, so `lib/payments/e2e-provider-base.ts` adds one flag-gated seam: `INVOSMART_E2E_PROVIDER_BASE_URL`. With it unset, the payment clients are built exactly as before (unit-tested under `NODE_ENV=production`). With it set: loopback `http` URLs only (`127.0.0.1`, `localhost`, `[::1]`); refused at import on Vercel (`VERCEL`/`VERCEL_ENV`); refused with a live Stripe key (`sk_live_`/`rk_live_`) or a non-sandbox Midtrans server key (not `SB-`); `npm run release:certify` rejects it. The stub serves the Snap sandbox and production base URLs on different paths (`/snap-sandbox/v1`, `/snap-production/v1`) so tests can see which one the app used, plus the fake `snap.js`.
- Inbound webhooks are forged with the real signature algorithms and the e2e secrets (`test/e2e/support/webhooks.ts`).
- The `guards` fixture is the only place that routes the Midtrans `snap.js` hosts to the stub; every other browser request to a non-loopback host is aborted and fails the test. It also collects `pageerror` and CSP violation events.

### Cookies and URLs

The e2e server is always `next start` (production), so the CSRF cookie is `__Host-csrf-token`, which is `Secure`. Playwright's `APIRequestContext` sends Secure cookies only to `localhost`, so the app, `baseURL` and `NEXTAUTH_URL` use `http://localhost:${E2E_APP_PORT}`; the stub and the database stay on `127.0.0.1`. The `api` fixture sends the cookie's value as `x-csrf-token`. There is no CSRF bypass.

## Environment

`test/e2e/playwright.env.ts` is the single source of e2e env: ports, URLs, secrets, persona identities, and the full env handed to each server (`e2eAppEnv()`, `e2eContractAppEnv()`). Every provider and telemetry variable is set explicitly, blank where the integration must be absent, so ambient shell values cannot leak into a run. Variables you may set when running the suite:

| Variable | Default | Effect |
|---|---|---|
| `E2E_APP_PORT` | `3000` | App port. Baked into the build stamp (`NEXT_PUBLIC_APP_URL`), see below |
| `E2E_DB_PORT` | `54329` | pglite-server port; `/ready` on `+1`; the migrate check uses `+20` |
| `E2E_STUB_PORT` | `4010` | Provider stub port |
| `E2E_WORKSPACE_AUTH_MODE` | `enforce` | Sets the app's `WORKSPACE_AUTH_MODE` and selects `@mode:` scenarios |
| `E2E_TIER` | unset | `nightly` raises `globalTimeout` to 22 min (15 min otherwise); `staging` enables `@staging` specs |
| `E2E_SCHEMA_MODE` | `push` | `push` (`prisma db push`) or `migrate` (`prisma migrate deploy`, broken on a fresh DB today) |
| `E2E_CONTRACT_ONLY` | unset | `1` = no-DB contract gate (`npm run test:e2e:contract`) |
| `PLAYWRIGHT_BASE_URL` | unset | Staging run against a deployed app: no `webServer`, only `@staging` specs |
| `E2E_STAGING_USER_EMAIL` / `_PASSWORD` | unset | The staging account (GitHub `staging` environment secrets) |
| `CI` | unset | `retries: 1`, `forbidOnly`, video on failure |
| `TMPDIR` | system | Put it on disk, see Local machine notes |

Key app values set by `e2eAppEnv()`: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<db>/postgres?connection_limit=1&pool_timeout=30`, `DATABASE_POOL_MAX=1`, `NODE_ENV=production`, `ADMIN_USER_IDS=e2e-platform-admin`, `CRON_SECRET`, `INVOICE_SHARE_SECRET`, `WORKSPACE_NOTIFICATION_ENCRYPTION_KEY`, test-mode Stripe/Midtrans/Resend/OpenAI keys, `INVOSMART_E2E_PROVIDER_BASE_URL`, `UPTIME_MONITORED_ENDPOINTS`, `ENABLE_RECEIPTS`/`ENABLE_RECEIPT_STAMPS=true`, the `ENABLE_AI_*` flags (`ENABLE_AI_FEDERATION=false`, `ENABLE_AI_ORCHESTRATION=memory`), `AI_SA_MAX_AUTOPUBLISH_PER_DAY=1`. Read the file for the exact list.

### E2E_APP_PORT and the build stamp

`NEXT_PUBLIC_*` values are inlined by `next build`, and `NEXT_PUBLIC_APP_URL` contains the app port. `npm run e2e:build` fingerprints those values into `.next/e2e-build.json`, and the config rejects a run whose fingerprint differs. If port 3000 is busy on your machine, build and run with the same port:

```bash
E2E_APP_PORT=3107 npm run e2e:build
E2E_APP_PORT=3107 npm run test:e2e:smoke
```

## Tiers and tags

| Tier | Selection | Where |
|---|---|---|
| Smoke | `@smoke` in the title or `tag` (`npm run test:e2e:smoke`) | Every PR, job `e2e-smoke`, `enforce` mode |
| Full | everything except `@staging` (`npm run test:e2e`) | Nightly `e2e-full.yml`, matrix `enforce` and `compat` |
| Staging | `@staging` (`npm run test:e2e:staging`) | `post-deploy-tests` (tag builds) and the manual `staging-certification` job, against the deployed URL |

- `@mode:enforce` / `@mode:compat` mark mode-specific scenarios; the config's `grepInvert` drops the ones that do not match `E2E_WORKSPACE_AUTH_MODE`. Playwright ANDs this with the CLI `--grep`.
- `@staging` specs (AUTH-08 Google OAuth, MAIL-05 Resend, PAY-12 sandbox payments, Slack delivery) also call `test.skip(process.env.E2E_TIER !== "staging")`, so they never run against the local stub. They use real sandbox providers and the `E2E_STAGING_USER_*` account; running them is a user action (they need the staging secrets).
- Projects: `setup` (personas), `chromium` (browser specs, default `owner` storage state), `api` (`specs/api-v1/**` and `specs/security/**/*.api.spec.ts`, no browser). Run one project with `--project=api`.

## CI jobs

| Job | File | Steps of note | Limit |
|---|---|---|---|
| `build-and-test` | `.github/workflows/release.yml` | lint, typecheck, unit tests, `npm run test:integration`, plain `npm run build`, `release:check` | |
| `e2e-smoke` | `release.yml` | `npm ci`, `prisma generate`, cached Chromium, `npm run e2e:build`, `node scripts/e2e-coverage-check.mjs`, `npm run test:e2e:smoke`, per-spec durations, `QA-report` artifact (7 days) | 20 min (Playwright `globalTimeout` 15) |
| `e2e-full` | `.github/workflows/e2e-full.yml` | nightly + manual; matrix `enforce`/`compat`; non-blocking migration replay check; `npm run test:e2e`; measured gate warns above 18 min; artifacts 14 days | 25 min (`globalTimeout` 22) |
| `post-deploy-tests` | `release.yml` | `@staging` only, `environment: staging` | 20 min |
| `staging-certification` | `release.yml` | `release:certify`, then `@staging` | manual |

### Measured budgets

Measured locally on this branch (Node 24.21, one worker, a memory-constrained Linux laptop):

| Run | Tests | Wall time |
|---|---|---|
| `npm run e2e:build` | - | ~3 min |
| `npm run test:e2e:smoke` | 21 | ~24 s |
| `npm run test:e2e` (per mode, enforce and compat) | 237 | ~2.8 min |
| `npx playwright test --project=api` | 80 | ~16 s |
| `npm run test:integration` | 32 | ~7 s |

CI numbers are pending the first green PR run and the first nightly run (user-run). Record them here from the "Per-spec durations" step summary and only then tune `globalTimeout` or the job limits.

## Coverage check

`scripts/e2e-coverage-check.mjs` enumerates every page (`app/**/page.{tsx,ts,jsx,js}`) and route handler (`app/**/route.{ts,js}`), maps each to its URL pattern, and scans `test/e2e/specs/**` and `test/integration/db/**` for coverage annotations. It exits 1 when a route has neither a scenario nor a waiver in `test/e2e/coverage-waivers.json`, or when the waiver file is invalid.

```bash
node scripts/e2e-coverage-check.mjs            # summary, holes, waivers
node scripts/e2e-coverage-check.mjs --verbose  # also annotations that match no route (e.g. /sw.js)
node scripts/e2e-coverage-check.mjs --json
```

Route mapping: `app/app/invoices/[id]/page.tsx` is `/app/invoices/[id]`; `app/api/clients/route.ts` is `/api/clients`. Route groups `(name)`, parallel slots `@name`, private `_folders` and `__tests__` are ignored. Dynamic segments are compared as wildcards regardless of their parameter name (`[id]` matches `[experimentId]`; `[...a]` matches `[...b]`). Annotate with the pattern, not a concrete URL: `/app/invoices/abc` does not match. Query strings and trailing slashes are ignored.

Annotation forms (any one counts):

1. Playwright annotation objects: `{ type: "covers", description: "/api/clients" }`.
2. The specs' helper: `covers("/api/clients", "/app/clients/[id]")`, usually spread into `annotation`. An identifier argument resolves against a `const NAME = "..."` string in the same file. Anything computed (`covers(row.route)`, `covers(...PAGES.map(...))`) cannot be read statically and counts for nothing, with a warning.
3. Tags: `@covers: /api/a, /api/b` anywhere in the file (comments, strings). Use a tag next to a data-driven loop to mirror its computed `covers()` argument (see `specs/security/isolation.api.spec.ts`), and in the integration layer, which has no Playwright annotations. The check stays quiet about computed arguments in a file that has tags.

A computed argument is the one place static parsing can drift from runtime. To compare, run `npx playwright test --list --reporter=json` and collect `annotations[type=covers]`; on this branch the two sets are identical.

Waiver statuses:

| `status` | Meaning | Check |
|---|---|---|
| `waived` (default) | The route exists and has no scenario, for the stated reason | Fails if the route no longer exists; warns if it is now covered |
| `no-route` | The plan names a route that does not exist | Fails if the route file appears, so the waiver cannot hide a new route |
| `partial` | The route is covered; the reason names the parts no scenario exercises | Fails if the route loses its scenarios |

`featureGap: true` marks a missing product feature that needs an owner's decision; the report prints it. Current waivers: `/api/auth/[...nextauth]` (partial: Google OAuth is staging-only; `/providers`, `/error`, `/_log` untested), `/app/workspace-invitations` (no index page), `/receipts/[id]` (no page; `/verify` exists), `/api/workspaces/[id]` (no route: workspace rename and delete are intentionally out of scope).

## Adding a scenario

1. Pick the area directory under `test/e2e/specs/<area>/`. Request-only files go in `specs/api-v1/` or are named `*.api.spec.ts` under `specs/security/` (the `api` project); everything else runs in `chromium`.
2. Import `{ test, expect }` from `../../fixtures` (not `@playwright/test`). Fixtures: `api` and `factory` (same identity as the page), `persona("member")`, `isolatedUser` (a fresh user and workspace with a browser context; use it for lists, totals and empty states), `newApiUser`, `stub` (reset per test; `stub.requests()` for provider assertions), `payments`, `guards` (automatic).
3. Create data through `support/api-factories.ts`; never open a Prisma client from a spec. If the assertion needs the database, write a `test/integration/db/*.test.ts` case instead.
4. Name the test with its catalogue id (`INV-04 ...`), tag it (`{ tag: "@smoke" }`, `@mode:compat`, `@staging`), and annotate every route it exercises: `{ annotation: covers("/api/invoices", "/app/invoices/[id]") }`.
5. Selectors: roles, labels and headings; the UI mixes Indonesian and English, so assert on stable headings. No `waitForTimeout`; use web-first assertions and `expect.poll` for asynchronous writes such as audit logs. Use `test.slow()` for PDF and AI paths.
6. A product bug is encoded as `test.fail(true, "<reason>")` with the desired behaviour asserted and an `issue` annotation; never weaken the assertion.
7. Run the new file under both modes if it is mode-dependent, then `npm run typecheck:e2e`, `npm run lint` and `node scripts/e2e-coverage-check.mjs`.

## Expected failures

These tests assert the desired behaviour and are marked as expected to fail until the product bug is fixed. When a fix lands, the test starts "passing unexpectedly" and fails the run; remove the marker then.

| Test | Marker | Product bug |
|---|---|---|
| CLI-03b (`specs/clients/clients.spec.ts`) | `test.fail` | `POST /api/clients` does not handle the `@@unique([userId, email])` violation when the same user reuses a client email in a second workspace: 500 instead of 4xx |
| EXP-05 (`specs/export/export.spec.ts`) | `test.fail` | CSV export does not neutralise formula cells (CSV injection; `lib/export-utils.ts` `escapeCSVCell`, momus-gated) |
| EXP-06 (`specs/export/export.spec.ts`) | `test.fail` | Export dates are UTC, not the Asia/Jakarta calendar date (`formatDateForExport`, momus-gated) |
| API-07b (`specs/api-v1/invoices.spec.ts`) | `test.fail` | `lib/api-v1/rate-limit.ts` refuses the limit-th request (off by one against `x-ratelimit-limit`) |
| OPT-04b (`specs/admin/optimizer.spec.ts`) | `test.fail` | Schedule auto-applies never consume the `AI_SA_MAX_AUTOPUBLISH_PER_DAY` quota (approval gates count `AUTOPUBLISH` only) |
| JRN-01b (`specs/journeys/register-to-paid.spec.ts`) | `test.fail` | Payment settlement audit rows (Midtrans notification and Stripe webhook) carry no `tenantId`, so the workspace audit API never shows them |
| fixtures guard self-test (`specs/support/fixtures.spec.ts`) | `test.fail` | Not a product bug: proves the `guards` fixture fails a test that requests a non-loopback host |
| WS-14 compat fallback (`test/integration/db/workspaces.test.ts`) | `it.fails` | `docs/WORKSPACE_RBAC.md` "Migration sequence" step 5 promises a compat `userId` fallback for legacy null-organization rows that `lib/workspaces.ts` does not implement; a passing pin test asserts current behaviour |

## Product observations

Recorded while building the suite; none is fixed by it.

- Midtrans environment mismatch: the server picks Snap `isProduction` from `NODE_ENV` (`lib/payments/midtrans.ts`) while the browser picks the `snap.js` host from the client-key prefix (`getSnapScriptUrl()`), so a sandbox key under `next start` loads sandbox `snap.js` but calls the production Snap API.
- XLSX export is SpreadsheetML XML served under an `.xlsx` name (`exportToXLSX`); EXP-02 asserts the current bytes.
- Audit entries with a null `tenantId`: sign-in (`AUTH_LOGIN_SUCCESS`, AUD-INT-01), registration (`AUTH_REGISTER`) and payment settlement (`INVOICE_UPDATE` from the webhooks, JRN-01b). They never appear in the workspace-scoped audit API.
- `/app/admin/audit-logs` pagination links keep `action` and `entity` but drop the `userId` and `tenantId` filters (`app/app/admin/audit-logs/page.tsx`).
- `/api/ai/theme-suggest` took about 9.5 s per call in the e2e build with the Upstash variables blank. Likely cause, not root-caused: `Redis.fromEnv()` in `lib/cache/theme-suggestions.ts` accepts the blank values and the client retries before the error is swallowed.
- `public/sw.js` precaches `/app/dashboard` on install. Signed out, that URL redirects to `/auth/login`, and the CSP's `upgrade-insecure-requests` turns the redirect into `https://localhost`, so on plain-http hosts `cache.addAll()` rejects and the worker goes redundant (PWA-01 runs signed in for this reason).
- The dashboard lists only the newest 20 invoices with no pagination control (INV-10).
- `/app/admin` (the hub) has no platform-admin gate, while three of the pages it links to do (`audit-logs` page, `uptime` and `feature-flags` layouts): a workspace owner sees the cards and is redirected to `/app` from the audit-logs card (ADM-01). Experiments and auto-actions are workspace-level.
- Workspace rename and delete are intentionally out of scope: there is no route or UI (waiver `/api/workspaces/[id]`, status `no-route`; it fails if the route appears).
- `prisma migrate deploy` fails on a fresh database: `20260811171520_add_m0_phase2_models` adds an FK to `"Client"` before `20260813120000_workspace_rbac_foundation` creates it (`P3018`). A separate migration-repair task owns the fix.

## Known limitations

- The schema is applied with `prisma db push` (`E2E_SCHEMA_MODE=push`) because the migration chain is broken on a fresh database. The nightly job runs `E2E_SCHEMA_MODE=migrate node test/e2e/support/db/serve.mjs --check` as a non-blocking step; switch the default to `migrate` once the repair lands.
- `workers: 1` and one in-memory database per run. The next step if the nightly run exceeds 18 min is sharding with one pglite-server and stub per shard (ports already come from env).
- Interactive transactions under `connection_limit=1` can hit Prisma `P2028` (transaction `maxWait`). Not seen so far; if it appears, raise `maxWait` in the probe and note it here rather than changing app code.
- The `@staging` tier, Google OAuth, Slack delivery and real sandbox payments run only on staging, with secrets the user adds to the GitHub `staging` environment (`E2E_STAGING_USER_EMAIL`, `E2E_STAGING_USER_PASSWORD`). They are user-run.

## Local machine notes

- Node 24: the repo pins `24.x` (`.nvmrc`, `engines`). Node 26 breaks jsdom in the unit tests; if your system Node is newer, put a Node 24 first on `PATH`.
- `TMPDIR`: on machines where `/tmp` is a small RAM-backed tmpfs, Playwright traces, Next.js and Prisma temp files can fill it. Point `TMPDIR` at a disk directory; `.e2e-tmp/` in the repo is gitignored for this:

  ```bash
  mkdir -p .e2e-tmp && export TMPDIR="$PWD/.e2e-tmp"
  ```

- Memory: `next build` and Chromium are the heavy parts. A cold `npm run e2e:build` (fresh clone, no `tsconfig.tsbuildinfo`) peaked at about 3 GB resident during "Checking validity of types" and was OOM-killed twice on a 7.6 GB machine with about 3.3 GB available; free memory before building. Under swap pressure Chromium can crash mid-test (`Target page, context or browser has been closed`), which looks like a flaky test. Close other heavy processes, or run `--project=api` for request-only work.
- Port conflicts: the run fails fast if `E2E_APP_PORT`, `E2E_DB_PORT`/`+1` or `E2E_STUB_PORT` is taken (`reuseExistingServer: false`). Change the port with the env variable; for the app port, rebuild with the same value.

## Prisma 7 notes

Upgrade Phase 7 (`.plans/tech-stack-upgrade.md`) moves to Prisma 7 with `@prisma/adapter-pg`:

- The `pg` pool must be created with `max: Number(process.env.DATABASE_POOL_MAX ?? 5)` (production default unchanged); e2e sets `DATABASE_POOL_MAX=1` because PGlite serves one connection. The `connection_limit=1` URL parameter is a Prisma 6 engine setting and does not size an adapter pool.
- Prisma 7 removes `prisma db push --skip-generate`; drop the flag in `test/e2e/support/db/schema.mjs` (`schemaArgs`) at that phase and update `schema.test.mjs`.
- Re-run `npm run e2e:db:probe` and `npm run test:db-support` after the upgrade.
