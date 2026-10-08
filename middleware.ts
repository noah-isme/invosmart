import { withAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
  LEGACY_CSRF_COOKIE_NAME,
  generateCsrfToken,
  getCsrfCookieName,
  getCsrfCookieOptions,
  isCsrfExemptWebhook,
  validateCsrfToken,
} from "@/lib/security/csrf";

type ResponseCookies = {
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
};

export function handleCsrfAndResponse(req: NextRequest): Response {
  const pathname = req.nextUrl?.pathname || "";
  const method = req.method ? req.method.toUpperCase() : "GET";

  const reqWithCookies = req as unknown as {
    cookies?: { get: (name: string) => { value?: string } | undefined };
  };

  // API-key clients are not browser sessions and cannot safely participate in
  // the double-submit-cookie flow. Their bearer credential is verified by the
  // versioned route itself, so CSRF protection remains enabled for all other
  // mutating /api routes.
  const isVersionedApiKeyRequest =
    pathname.startsWith("/api/v1/") &&
    /^Bearer\s+inv_live_/i.test(req.headers.get("authorization") ?? "");

  // Provider webhooks (exact path, POST only; see lib/security/csrf.ts) are
  // authenticated by a signature check inside the route, not by a browser
  // session, so they bypass CSRF and do not receive a CSRF cookie.
  const isSignedWebhook = isCsrfExemptWebhook(pathname, method);
  if (isSignedWebhook) {
    return NextResponse.next();
  }

  // Enforce CSRF token validation on all mutating API routes (POST, PUT, DELETE, PATCH under /api/*)
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    !isVersionedApiKeyRequest &&
    process.env.NODE_ENV !== "test" &&
    CSRF_PROTECTED_METHODS.includes(method)
  ) {
    const cookieToken = reqWithCookies.cookies?.get(getCsrfCookieName())?.value;
    const headerToken = req.headers.get(CSRF_HEADER_NAME);

    if (!validateCsrfToken(cookieToken, headerToken)) {
      return NextResponse.json(
        { error: "Invalid or missing CSRF token" },
        { status: 403 }
      );
    }
  }

  const response = NextResponse.next();

  // Ensure CSRF cookie is set on outgoing responses when missing
  const responseCookies = (response as unknown as { cookies: ResponseCookies }).cookies;
  const cookieName = getCsrfCookieName();
  if (!reqWithCookies.cookies?.get(cookieName)?.value) {
    responseCookies.set(cookieName, generateCsrfToken(), getCsrfCookieOptions());
  }

  // Browsers that still hold the old HttpOnly cookie cannot read it from JS and
  // it is no longer consulted, so expire it.
  if (reqWithCookies.cookies?.get(LEGACY_CSRF_COOKIE_NAME)) {
    responseCookies.set(LEGACY_CSRF_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  }

  return response;
}

export default withAuth(
  function middleware(req: NextRequest) {
    return handleCsrfAndResponse(req);
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        const pathname = req?.nextUrl?.pathname;
        if (pathname && pathname.startsWith("/app")) {
          return !!token;
        }
        return true;
      },
    },
  }
);

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
