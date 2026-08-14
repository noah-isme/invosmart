import nextConfig from "@/next.config";
import { describe, expect, it, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { handleCsrfAndResponse } from "@/middleware";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  generateCsrfToken,
} from "@/lib/security/csrf";

describe("Security headers and CSP", () => {
  it("exposes required security headers including CSP on all routes", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toBeDefined();
    expect(headers?.[0].source).toBe("/(.*)");

    const headerMap = new Map(
      headers?.[0].headers.map((header: { key: string; value: string }) => [
        header.key,
        header.value,
      ])
    );

    expect(headerMap.get("X-Frame-Options")).toBe("DENY");
    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerMap.get("Permissions-Policy")).toBe("geolocation=()");

    const csp = headerMap.get("Content-Security-Policy");
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
  });
});

describe("Middleware CSRF Validation", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("returns 403 Forbidden for mutating POST request without CSRF token in development mode", async () => {
    process.env.NODE_ENV = "development";
    const req = new NextRequest("http://localhost:3000/api/invoices", {
      method: "POST",
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body).toEqual({ error: "Invalid or missing CSRF token" });
  });

  it("returns 403 Forbidden for mutating POST request with mismatched CSRF token in development mode", async () => {
    process.env.NODE_ENV = "development";
    const req = new NextRequest("http://localhost:3000/api/invoices", {
      method: "POST",
      headers: {
        [CSRF_HEADER_NAME]: "invalid-header-token-1234567890123456789012345678901234567890",
        cookie: `${CSRF_COOKIE_NAME}=different-cookie-token-123456789012345678901234567890`,
      },
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(403);
  });

  it("allows mutating POST request with valid matching CSRF token in development mode", async () => {
    process.env.NODE_ENV = "development";
    const token = generateCsrfToken();
    const req = new NextRequest("http://localhost:3000/api/invoices", {
      method: "POST",
      headers: {
        [CSRF_HEADER_NAME]: token,
        cookie: `${CSRF_COOKIE_NAME}=${token}`,
      },
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(200);
  });

  it("exempts /api/auth/* routes from CSRF validation even on mutating POST request", async () => {
    process.env.NODE_ENV = "development";
    const req = new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(200);
  });

  it("exempts versioned API-key requests from browser CSRF validation", async () => {
    process.env.NODE_ENV = "development";
    const req = new NextRequest("http://localhost:3000/api/v1/invoices", {
      method: "POST",
      headers: { authorization: "Bearer inv_live_0123456789abcdef_secret" },
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(200);
  });

  it("exempts validation when process.env.NODE_ENV === 'test'", async () => {
    process.env.NODE_ENV = "test";
    const req = new NextRequest("http://localhost:3000/api/invoices", {
      method: "POST",
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(200);
  });

  it("ensures CSRF cookie is set on outgoing response when missing", async () => {
    process.env.NODE_ENV = "development";
    const req = new NextRequest("http://localhost:3000/api/public", {
      method: "GET",
    });

    const res = handleCsrfAndResponse(req);
    expect(res.status).toBe(200);
    const cookieHeader = res.headers.get("set-cookie");
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain(CSRF_COOKIE_NAME);
  });
});
