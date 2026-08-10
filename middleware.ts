import { withAuth } from "next-auth/middleware";
import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  generateCsrfToken,
  validateCsrfToken,
} from "@/lib/security/csrf";

export function handleCsrfAndResponse(req: NextRequest): Response {
  const pathname = req.nextUrl?.pathname || "";
  const method = req.method ? req.method.toUpperCase() : "GET";

  const reqWithCookies = req as unknown as {
    cookies?: { get: (name: string) => { value?: string } | undefined };
  };

  // Enforce CSRF token validation on all mutating API routes (POST, PUT, DELETE, PATCH under /api/*)
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") &&
    process.env.NODE_ENV !== "test" &&
    ["POST", "PUT", "DELETE", "PATCH"].includes(method)
  ) {
    const cookieToken = reqWithCookies.cookies?.get(CSRF_COOKIE_NAME)?.value;
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
  let csrfToken = reqWithCookies.cookies?.get(CSRF_COOKIE_NAME)?.value;
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    (response as unknown as { cookies: { set: (name: string, value: string, options?: Record<string, unknown>) => void } }).cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
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

