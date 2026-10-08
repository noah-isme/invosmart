/**
 * CSRF double-submit helpers.
 *
 * This module is imported by the root middleware, which runs on the Edge
 * runtime (and on the Node runtime once it is renamed to proxy.ts), so it must
 * only use Web Platform APIs: no `import crypto from "crypto"` and no `Buffer`.
 */

export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_HEADER = CSRF_HEADER_NAME;

/**
 * Name of the pre-fix cookie. It was issued HttpOnly, so browsers that still
 * hold it cannot read it from JS and the middleware must expire it.
 */
export const LEGACY_CSRF_COOKIE_NAME = "csrf-token";

/**
 * Name of the CSRF cookie. Single source of truth for the middleware and the
 * browser helper (Next inlines `process.env.NODE_ENV` in client bundles).
 *
 * - Production: `__Host-csrf-token`. The `__Host-` prefix makes browsers
 *   require Secure + Path=/ and no Domain, which also stops sibling
 *   subdomains from planting ("tossing") a cookie of that name.
 * - Otherwise: `csrf-token-v2`, because `__Host-` needs Secure and local
 *   development runs over plain http.
 *
 * Evaluated on each call so tests can switch NODE_ENV.
 */
export function getCsrfCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-csrf-token"
    : "csrf-token-v2";
}

/**
 * Provider webhooks that authenticate by verifying a signature over the raw
 * body and therefore cannot carry a browser CSRF token. Matched by exact
 * pathname and POST only; never use prefix matching.
 *
 * Any path added here MUST verify a signature before any side effect (DB
 * access included), fail closed when its secret is missing, and MUST NOT read
 * the user's session or cookies.
 */
const CSRF_EXEMPT_WEBHOOK_SET: ReadonlySet<string> = new Set([
  "/api/payments/stripe/webhook",
  "/api/payments/midtrans/notification",
  "/api/webhooks/resend",
]);

/** Frozen copy of the allowlist, for documentation and tests. */
export const CSRF_EXEMPT_WEBHOOK_PATHS: readonly string[] = Object.freeze([
  ...CSRF_EXEMPT_WEBHOOK_SET,
]);

/** True for a POST to one of the signature-verified webhook endpoints. */
export function isCsrfExemptWebhook(pathname: string, method: string): boolean {
  return (
    method.toUpperCase() === "POST" && CSRF_EXEMPT_WEBHOOK_SET.has(pathname)
  );
}

/** HTTP methods that must carry a valid CSRF token. */
export const CSRF_PROTECTED_METHODS: readonly string[] = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

type RequestWithCookies = Request & {
  cookies?: {
    get: (name: string) => { value?: string } | undefined;
  };
};

/**
 * Attributes for the CSRF cookie. The cookie is intentionally readable by
 * same-origin JavaScript (not httpOnly) so the client can echo it in the
 * `x-csrf-token` header; the token is not a session secret. SameSite=Lax keeps
 * it off cross-site subrequests, and Secure is enforced in production.
 */
export function getCsrfCookieOptions(): {
  httpOnly: false;
  sameSite: "lax";
  path: "/";
  secure: boolean;
} {
  return {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Generate a cryptographically secure random CSRF token (32 bytes, hex).
 * Uses Web Crypto so it works on both the Edge and Node runtimes.
 */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Constant-time string comparison that does not rely on Node's crypto module.
 * The loop always runs over the longer input, and a length mismatch is folded
 * into the accumulated difference rather than returning early.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Validate CSRF token using Double Submit Cookie verification with a constant-time comparison.
 * Returns false for missing, empty, mismatched, or non-string tokens.
 */
export function validateCsrfToken(
  cookieToken: string | undefined | null,
  headerToken: string | undefined | null
): boolean {
  if (
    !cookieToken ||
    !headerToken ||
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string"
  ) {
    return false;
  }

  const trimmedCookie = cookieToken.trim();
  const trimmedHeader = headerToken.trim();

  if (trimmedCookie === "" || trimmedHeader === "") {
    return false;
  }

  return timingSafeStringEqual(trimmedCookie, trimmedHeader);
}

/**
 * Helper function for verifying CSRF token from a Request or NextRequest.
 */
export function verifyCsrfToken(req: Request): boolean {
  let cookieToken: string | undefined | null = null;

  const requestWithCookies = req as RequestWithCookies;
  if (typeof requestWithCookies.cookies?.get === "function") {
    cookieToken = requestWithCookies.cookies.get(getCsrfCookieName())?.value;
  }

  if (!cookieToken && req.headers) {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${getCsrfCookieName()}=([^;]*)`)
    );
    if (match) {
      cookieToken = decodeURIComponent(match[1]);
    }
  }

  const headerToken =
    req.headers.get(CSRF_HEADER_NAME) ||
    req.headers.get(CSRF_HEADER_NAME.toLowerCase());

  return validateCsrfToken(cookieToken, headerToken);
}

export const verifyCsrfRequest = verifyCsrfToken;
