## 2026-08-11T02:08:43Z
You are teamwork_preview_worker agent worker_m5_1 for Milestone M5 (CSRF Protection & Content-Security-Policy).
Your working directory is /home/noah/project/invosmart/.agents/worker_m5_1. Create your working directory if needed and write your BRIEFING.md and progress.md there.

Task scope and file ownership:
You have exclusive write access to:
- `lib/security/csrf.ts`
- `middleware.ts`
- `next.config.ts`
- `lib/__tests__/csrf.test.ts`
- `app/__tests__/security.headers.test.ts`

Read /home/noah/project/invosmart/PROJECT.md and /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md before starting work.

Detailed instructions:
1. Create `lib/security/csrf.ts` implementing:
   - CSRF token generation (`generateCsrfToken(): string`) using cryptographically secure random bytes.
   - CSRF token validation (`validateCsrfToken(cookieToken: string | undefined | null, headerToken: string | undefined | null): boolean`) using Double Submit Cookie verification with timing-safe comparison (`crypto.timingSafeEqual`). Return `false` for missing/empty/mismatched tokens.
   - Constants for cookie name (`csrf-token`) and header name (`x-csrf-token`), plus helper function for API route verification.

2. Update `middleware.ts`:
   - Enforce CSRF token validation on all mutating API routes (`POST`, `PUT`, `DELETE`, `PATCH` under `/api/*`).
   - Exception handling: bypass validation for NextAuth routes (`/api/auth/*`) or when `process.env.NODE_ENV === 'test'`.
   - On invalid/missing CSRF token, return HTTP 403 Forbidden response (`NextResponse.json({ error: 'Invalid or missing CSRF token' }, { status: 403 })`).
   - Ensure existing middleware functionality and API routes do NOT break.
   - Ensure CSRF cookie is set on outgoing responses when missing.

3. Update `next.config.ts`:
   - In `headers()` section, add strict `Content-Security-Policy` (CSP) header with directives:
     `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests`

4. Add unit test `lib/__tests__/csrf.test.ts` and update `app/__tests__/security.headers.test.ts`:
   - Test CSRF token generation and Double Submit Cookie validation with edge cases (missing headers/cookies, mismatched tokens, timing safety).
   - Test CSP headers and middleware CSRF token validation (403 on missing/invalid token for mutating POST request, exemption for `/api/auth/*` and `NODE_ENV === 'test'`).

5. Verification:
   - Run `npm run test` (or vitest) and verify all tests pass.
   - Run `npm run lint` and `npm run build` to verify clean build.

Write your report to `/home/noah/project/invosmart/.agents/worker_m5_1/handoff.md` with:
- Summary of changes made
- Build and test commands executed with verbatim outputs
- Verification results

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Send a message to parent sub_orch_m5 when completed.
