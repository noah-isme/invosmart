// Session and request-guard helpers for the e2e suite.
//
// - CSRF: the app uses double-submit cookies (middleware.ts). Every mutating
//   /api request outside /api/auth/* and the signed webhooks must echo the
//   CSRF cookie in the `x-csrf-token` header.
// - Rate limits: lib/rate-limit.ts keys its in-memory buckets on the first
//   `x-forwarded-for` value, so every factory request gets a fresh one.
// - Sessions: credentials login goes through the real next-auth endpoints;
//   `next-auth/jwt` is used only to mint deliberately invalid tokens (AUTH-11).
import type { APIRequestContext } from "@playwright/test";
import { encode } from "next-auth/jwt";

import { CSRF_HEADER_NAME } from "../../../lib/security/csrf";
import { E2E_SECRETS } from "../playwright.env";

/**
 * Name of the CSRF cookie the e2e app issues. The app runs `next start`
 * (NODE_ENV=production), so this is the production name; a Vitest test pins it
 * to `getCsrfCookieName()` under NODE_ENV=production.
 */
export const E2E_CSRF_COOKIE = "__Host-csrf-token";

/**
 * next-auth session cookie name. NEXTAUTH_URL is plain http in e2e, so
 * next-auth uses the non-`__Secure-` cookie names.
 */
export const E2E_SESSION_COOKIE = "next-auth.session-token";

export { CSRF_HEADER_NAME };

// 10.<worker>.<hi>.<lo>: the worker index keeps parallel workers apart and the
// random start keeps a restarted worker from reusing addresses still counted
// in the app's 60 s rate-limit window.
const workerOctet = Number(process.env.TEST_WORKER_INDEX ?? 0) % 256;
let forwardedForCounter = Math.floor(Math.random() * 0x10000);

/** A fresh `x-forwarded-for` value on every call. */
export function uniqueForwardedFor(): string {
  forwardedForCounter = (forwardedForCounter + 1) % 0x10000;
  return `10.${workerOctet}.${forwardedForCounter >> 8}.${forwardedForCounter & 0xff}`;
}

async function readCsrfCookie(request: APIRequestContext): Promise<string | undefined> {
  const state = await request.storageState();
  return state.cookies.find((cookie) => cookie.name === E2E_CSRF_COOKIE)?.value;
}

/**
 * `{ "x-csrf-token": <cookie value> }` for the given request context. The
 * middleware sets the cookie on any /api response that arrives without it; if
 * the context has not made such a request yet, one GET primes it.
 */
export async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  let token = await readCsrfCookie(request);
  if (!token) {
    await request.get("/api/health", { headers: { "x-forwarded-for": uniqueForwardedFor() } });
    token = await readCsrfCookie(request);
  }
  if (!token) {
    throw new Error(
      `No ${E2E_CSRF_COOKIE} cookie after GET /api/health. Is the app served from http://localhost (Secure cookies)?`,
    );
  }
  return { [CSRF_HEADER_NAME]: token };
}

export type Credentials = { email: string; password: string };

export type SessionUser = { id: string; email: string; name?: string | null };

/** GET /api/auth/session; null when the context has no valid session. */
export async function getSessionUser(request: APIRequestContext): Promise<SessionUser | null> {
  const response = await request.get("/api/auth/session", {
    headers: { "x-forwarded-for": uniqueForwardedFor() },
  });
  if (!response.ok()) {
    throw new Error(`GET /api/auth/session -> ${response.status()}`);
  }
  const body = (await response.json()) as { user?: SessionUser } | null;
  return body?.user?.id ? body.user : null;
}

/**
 * Log in through the real next-auth credentials flow:
 * GET /api/auth/csrf, then POST /api/auth/callback/credentials. The session
 * cookie lands in `request`'s cookie jar. Throws with the next-auth error
 * when the credentials are rejected.
 */
export async function loginViaCredentialsApi(
  request: APIRequestContext,
  creds: Credentials,
): Promise<SessionUser> {
  const csrfResponse = await request.get("/api/auth/csrf", {
    headers: { "x-forwarded-for": uniqueForwardedFor() },
  });
  if (!csrfResponse.ok()) {
    throw new Error(`GET /api/auth/csrf -> ${csrfResponse.status()}`);
  }
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  // `json: "true"` makes next-auth answer { url } instead of a Location redirect.
  const callback = await request.post("/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": uniqueForwardedFor() },
    form: {
      csrfToken,
      email: creds.email,
      password: creds.password,
      callbackUrl: "/app",
      json: "true",
    },
    maxRedirects: 0,
  });
  const body = (await callback.json().catch(() => ({}))) as { url?: string };
  const error = body.url ? new URL(body.url, "http://localhost").searchParams.get("error") : null;
  if (callback.status() >= 400 || error) {
    throw new Error(
      `Credentials login for ${creds.email} failed: ${callback.status()} ${error ?? body.url ?? ""}`.trim(),
    );
  }

  const user = await getSessionUser(request);
  if (!user) {
    throw new Error(`Credentials login for ${creds.email} returned no session`);
  }
  return user;
}

/**
 * Mint a session JWT the way next-auth does, for AUTH-11 only: pass a wrong
 * `secret` (tampered) or an `exp` in the past (expired; at least 15 s back,
 * because next-auth decodes with a 15 s clock tolerance). `sub` should come
 * from GET /api/auth/session so only the property under test is wrong.
 * Returns the cookie value for E2E_SESSION_COOKIE.
 */
export async function mintTamperedSession({
  sub,
  exp,
  secret = E2E_SECRETS.NEXTAUTH_SECRET,
}: {
  sub: string;
  /** Expiry in epoch seconds. */
  exp: number;
  secret?: string;
}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // encode() always sets exp = now + maxAge, so derive maxAge from `exp`.
  return encode({ token: { sub }, secret, maxAge: exp - nowSeconds });
}
