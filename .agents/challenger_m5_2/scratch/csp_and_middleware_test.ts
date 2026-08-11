import { describe, expect, it, beforeEach, afterEach } from "vitest";
import nextConfig from "@/next.config";
import { handleCsrfAndResponse } from "@/middleware";
import { NextRequest } from "next/server";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, generateCsrfToken } from "@/lib/security/csrf";

describe("Empirical Challenge: CSP & Middleware Execution", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("1. CSP Header Inspection", () => {
    it("verify Content-Security-Policy header presence in next.config.ts", async () => {
      const headers = await nextConfig.headers?.();
      expect(headers).toBeDefined();

      const rootRouteHeaders = headers?.find((h: any) => h.source === "/(.*)");
      expect(rootRouteHeaders).toBeDefined();

      const headerMap = new Map(
        rootRouteHeaders?.headers.map((h: { key: string; value: string }) => [h.key, h.value])
      );

      const csp = headerMap.get("Content-Security-Policy");
      expect(csp).toBeDefined();
      expect(typeof csp).toBe("string");
    });

    it("verify all required CSP directives exist and are properly formatted", async () => {
      const headers = await nextConfig.headers?.();
      const rootRouteHeaders = headers?.find((h: any) => h.source === "/(.*)");
      const headerMap = new Map(
        rootRouteHeaders?.headers.map((h: { key: string; value: string }) => [h.key, h.value])
      );
      const csp = headerMap.get("Content-Security-Policy") || "";

      // Parse directives
      const directives = csp.split(";").map((d) => d.trim()).filter(Boolean);
      const directiveMap = new Map<string, string>();
      for (const dir of directives) {
        const parts = dir.split(/\s+/);
        const name = parts[0];
        const val = parts.slice(1).join(" ");
        directiveMap.set(name, val);
      }

      // Check default-src
      expect(directiveMap.has("default-src")).toBe(true);
      expect(directiveMap.get("default-src")).toContain("'self'");

      // Check script-src
      expect(directiveMap.has("script-src")).toBe(true);
      expect(directiveMap.get("script-src")).toContain("'self'");
      expect(directiveMap.get("script-src")).toContain("'unsafe-inline'");
      expect(directiveMap.get("script-src")).toContain("'unsafe-eval'");
      expect(directiveMap.get("script-src")).toContain("https://app.posthog.com");

      // Check style-src
      expect(directiveMap.has("style-src")).toBe(true);
      expect(directiveMap.get("style-src")).toContain("'self'");
      expect(directiveMap.get("style-src")).toContain("'unsafe-inline'");

      // Check img-src
      expect(directiveMap.has("img-src")).toBe(true);
      expect(directiveMap.get("img-src")).toContain("'self'");
      expect(directiveMap.get("img-src")).toContain("data:");
      expect(directiveMap.get("img-src")).toContain("blob:");
      expect(directiveMap.get("img-src")).toContain("https:");

      // Check font-src
      expect(directiveMap.has("font-src")).toBe(true);
      expect(directiveMap.get("font-src")).toContain("'self'");

      // Check connect-src
      expect(directiveMap.has("connect-src")).toBe(true);
      expect(directiveMap.get("connect-src")).toContain("'self'");
      expect(directiveMap.get("connect-src")).toContain("https://app.posthog.com");
      expect(directiveMap.get("connect-src")).toContain("https://*.ingest.sentry.io");

      // Check frame-ancestors
      expect(directiveMap.has("frame-ancestors")).toBe(true);
      expect(directiveMap.get("frame-ancestors")).toBe("'none'");

      // Check form-action
      expect(directiveMap.has("form-action")).toBe(true);
      expect(directiveMap.get("form-action")).toBe("'self'");

      // Check base-uri
      expect(directiveMap.has("base-uri")).toBe(true);
      expect(directiveMap.get("base-uri")).toBe("'self'");

      // Check object-src
      expect(directiveMap.has("object-src")).toBe(true);
      expect(directiveMap.get("object-src")).toBe("'none'");

      // Check upgrade-insecure-requests
      expect(directiveMap.has("upgrade-insecure-requests")).toBe(true);
    });
  });

  describe("2. Middleware CSRF & /api/auth/* Bypass Scoping", () => {
    beforeEach(() => {
      // Force NODE_ENV to production to test active middleware enforcement
      process.env.NODE_ENV = "production";
    });

    it("blocks POST to /api/invoices when CSRF token is missing", () => {
      const req = new NextRequest("https://localhost:3000/api/invoices", {
        method: "POST",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(403);
    });

    it("blocks PUT to /api/invoices when CSRF token is invalid/mismatched", () => {
      const req = new NextRequest("https://localhost:3000/api/invoices", {
        method: "PUT",
        headers: {
          [CSRF_HEADER_NAME]: "invalid-header-token",
          cookie: `${CSRF_COOKIE_NAME}=invalid-cookie-token-different`,
        },
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(403);
    });

    it("allows POST to /api/invoices when valid matching CSRF tokens are provided", () => {
      const token = generateCsrfToken();
      const req = new NextRequest("https://localhost:3000/api/invoices", {
        method: "POST",
        headers: {
          [CSRF_HEADER_NAME]: token,
          cookie: `${CSRF_COOKIE_NAME}=${token}`,
        },
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(200);
    });

    it("allows non-mutating GET to /api/invoices without CSRF token", () => {
      const req = new NextRequest("https://localhost:3000/api/invoices", {
        method: "GET",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(200);
    });

    it("allows POST to /api/auth/signin without CSRF token (bypass /api/auth/*)", () => {
      const req = new NextRequest("https://localhost:3000/api/auth/signin", {
        method: "POST",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(200);
    });

    it("allows POST to /api/auth/callback/credentials without CSRF token (bypass /api/auth/*)", () => {
      const req = new NextRequest("https://localhost:3000/api/auth/callback/credentials", {
        method: "POST",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(200);
    });

    it("blocks POST to /api/author without CSRF token (strictly scoped to /api/auth/)", () => {
      const req = new NextRequest("https://localhost:3000/api/author", {
        method: "POST",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(403);
    });

    it("blocks POST to /api/auth (no trailing slash) without CSRF token", () => {
      const req = new NextRequest("https://localhost:3000/api/auth", {
        method: "POST",
      });
      const res = handleCsrfAndResponse(req);
      expect(res.status).toBe(403);
    });
  });
});
