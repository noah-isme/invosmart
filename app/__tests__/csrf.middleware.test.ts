import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { handleCsrfAndResponse } from "@/middleware";
import {
  CSRF_EXEMPT_WEBHOOK_PATHS,
  CSRF_HEADER_NAME,
  LEGACY_CSRF_COOKIE_NAME,
  generateCsrfToken,
  getCsrfCookieName,
} from "@/lib/security/csrf";

const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

function setCookies(res: Response): string[] {
  return (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
}

describe("CSRF cookie rotation", () => {
  it("issues the new cookie and expires the legacy one when only the legacy cookie is sent", () => {
    process.env.NODE_ENV = "development";
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/public", {
        method: "GET",
        headers: { cookie: `${LEGACY_CSRF_COOKIE_NAME}=old-httponly-token` },
      })
    );

    const cookies = setCookies(res);
    const fresh = cookies.find((c) => c.startsWith("csrf-token-v2="));
    const expired = cookies.find((c) => c.startsWith(`${LEGACY_CSRF_COOKIE_NAME}=;`));
    expect(fresh).toMatch(/csrf-token-v2=[0-9a-f]{64}/);
    expect(expired).toBeDefined();
    expect(expired).toMatch(/max-age=0/i);
    expect(expired).toMatch(/path=\//i);
  });

  it("rejects a mutation that only carries the legacy cookie and header", async () => {
    process.env.NODE_ENV = "development";
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/invoices", {
        method: "POST",
        headers: {
          [CSRF_HEADER_NAME]: "old",
          cookie: `${LEGACY_CSRF_COOKIE_NAME}=old`,
        },
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Invalid or missing CSRF token" });
  });

  it("does not send a legacy expiry when no legacy cookie is present", () => {
    process.env.NODE_ENV = "development";
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/public", { method: "GET" })
    );
    expect(setCookies(res).some((c) => c.startsWith(`${LEGACY_CSRF_COOKIE_NAME}=`))).toBe(false);
  });

  it("uses the __Host- prefixed cookie in production: Secure, Path=/, no Domain, no HttpOnly", () => {
    process.env.NODE_ENV = "production";
    expect(getCsrfCookieName()).toBe("__Host-csrf-token");
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/public", { method: "GET" })
    );
    const cookie = setCookies(res).find((c) => c.startsWith("__Host-csrf-token="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/;\s*secure/i);
    expect(cookie).toMatch(/path=\//i);
    expect(cookie).not.toMatch(/domain=/i);
    expect(cookie).not.toMatch(/httponly/i);
  });

  it("uses csrf-token-v2 outside production", () => {
    process.env.NODE_ENV = "development";
    expect(getCsrfCookieName()).toBe("csrf-token-v2");
  });

  it("accepts a mutation with a matching production cookie and header", () => {
    process.env.NODE_ENV = "production";
    const token = generateCsrfToken();
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/invoices", {
        method: "POST",
        headers: {
          [CSRF_HEADER_NAME]: token,
          cookie: `__Host-csrf-token=${token}`,
        },
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("Signed provider webhook CSRF exemption", () => {
  const CSRF_BODY = { error: "Invalid or missing CSRF token" };

  const exempt = [
    "/api/payments/stripe/webhook",
    "/api/payments/midtrans/notification",
    "/api/webhooks/resend",
  ];

  it("lists exactly the three webhook paths and is frozen", () => {
    expect([...CSRF_EXEMPT_WEBHOOK_PATHS]).toEqual(exempt);
    expect(Object.isFrozen(CSRF_EXEMPT_WEBHOOK_PATHS)).toBe(true);
  });

  describe.each(["production", "development"])("NODE_ENV=%s", (env) => {
    it.each(exempt)("lets POST %s through without a CSRF token or cookie", (pathname) => {
      process.env.NODE_ENV = env;
      const res = handleCsrfAndResponse(
        new NextRequest(`http://localhost:3000${pathname}`, { method: "POST", body: "{}" })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("set-cookie")).toBeNull();
    });

    it.each([
      ["trailing slash", "/api/payments/stripe/webhook/", "POST"],
      ["suffix", "/api/payments/stripe/webhook-evil", "POST"],
      ["sub-path", "/api/payments/stripe/webhook/x", "POST"],
      ["suffix on midtrans", "/api/payments/midtrans/notification-evil", "POST"],
      ["sub-path on resend", "/api/webhooks/resend/x", "POST"],
      ["%2F-encoded", "/api/payments%2Fstripe%2Fwebhook", "POST"],
      ["doubled slashes", "/api//payments/stripe/webhook", "POST"],
      ["different case", "/api/Payments/Stripe/webhook", "POST"],
      ["different case resend", "/api/webhooks/Resend", "POST"],
      ["PUT on exempt path", "/api/payments/stripe/webhook", "PUT"],
      ["PATCH on exempt path", "/api/webhooks/resend", "PATCH"],
      ["DELETE on exempt path", "/api/payments/midtrans/notification", "DELETE"],
      ["normal route", "/api/invoices", "POST"],
      ["sibling payments route", "/api/payments/stripe/create-session", "POST"],
    ])("still enforces CSRF for %s (%s %s)", async (_label, pathname, method) => {
      process.env.NODE_ENV = env;
      const res = handleCsrfAndResponse(
        new NextRequest(`http://localhost:3000${pathname}`, { method })
      );
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(CSRF_BODY);
      expect(res.headers.get("x-middleware-next")).toBeNull();
    });
  });

  it("still issues the CSRF cookie for non-webhook GETs", () => {
    process.env.NODE_ENV = "production";
    const res = handleCsrfAndResponse(
      new NextRequest("http://localhost:3000/api/health", { method: "GET" })
    );
    expect(res.headers.get("set-cookie")).toContain("__Host-csrf-token=");
  });
});
