import crypto from "crypto";

export const CSRF_COOKIE_NAME = "csrf-token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const CSRF_COOKIE = CSRF_COOKIE_NAME;
export const CSRF_HEADER = CSRF_HEADER_NAME;

/**
 * Generate a cryptographically secure random CSRF token.
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Validate CSRF token using Double Submit Cookie verification with timing-safe comparison.
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

  const cookieBuf = Buffer.from(trimmedCookie, "utf-8");
  const headerBuf = Buffer.from(trimmedHeader, "utf-8");

  if (cookieBuf.length !== headerBuf.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(cookieBuf, headerBuf);
  } catch {
    return false;
  }
}

/**
 * Helper function for verifying CSRF token from a Request or NextRequest.
 */
export function verifyCsrfToken(req: Request): boolean {
  let cookieToken: string | undefined | null = null;

  if ("cookies" in req && typeof (req as any).cookies?.get === "function") {
    cookieToken = (req as any).cookies.get(CSRF_COOKIE_NAME)?.value;
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
