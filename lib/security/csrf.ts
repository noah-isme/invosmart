/**
 * CSRF double-submit helpers.
 *
 * This module is imported by the root middleware, which runs on the Edge
 * runtime (and on the Node runtime once it is renamed to proxy.ts), so it must
 * only use Web Platform APIs: no `import crypto from "crypto"` and no `Buffer`.
 */

export const CSRF_COOKIE_NAME = "csrf-token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const CSRF_COOKIE = CSRF_COOKIE_NAME;
export const CSRF_HEADER = CSRF_HEADER_NAME;

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
    cookieToken = requestWithCookies.cookies.get(CSRF_COOKIE_NAME)?.value;
  }

  if (!cookieToken && req.headers) {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(
      new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`)
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
