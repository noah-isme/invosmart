## 2026-08-11T02:07:57Z
You are Sub-orchestrator sub_orch_m5 for Milestone M5 (CSRF Protection & Content-Security-Policy).
Working directory: /home/noah/project/invosmart/.agents/sub_orch_m5
Scope document: /home/noah/project/invosmart/PROJECT.md
Read survey report: /home/noah/project/invosmart/.agents/explorer_survey_r1_r2/handoff.md and /home/noah/project/invosmart/.agents/ORIGINAL_REQUEST.md

Tasks to delegate to your Worker (worker_m5_1):
1. Create `lib/security/csrf.ts` implementing CSRF token generation, validation (`validateCsrfToken`), Double Submit Cookie verification, and helper function for API routes.
2. Update `middleware.ts` to enforce CSRF token validation on all mutating API routes (`POST`, `PUT`, `DELETE`, `PATCH` under `/api/*`), returning HTTP 403 Forbidden on invalid/missing tokens, with exception handling for NextAuth routes (`/api/auth/*`) or test environment (`NODE_ENV === 'test'`). Ensure existing API routes do NOT break.
3. Update `next.config.ts` headers() section to add strict `Content-Security-Policy` (CSP) header with directives (`default-src 'self'`, `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, `font-src 'self' data:`, `connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'`, `upgrade-insecure-requests`).
4. Add unit test `lib/__tests__/csrf.test.ts` and update `app/__tests__/security.headers.test.ts` to verify CSP headers and CSRF token validation.

Follow Project Pattern iteration loop: Worker -> Reviewers + Challengers -> Forensic Auditor -> Gate check (GATE_STATUS.md) -> Handoff report (handoff.md). Send completion message to parent when done.
