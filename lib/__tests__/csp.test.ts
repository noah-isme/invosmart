import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  getMidtransEnvironment,
} from "@/lib/security/csp";

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  expect(found, `directive ${name} should exist`).toBeDefined();
  return found!.split(/\s+/).slice(1);
}

describe("getMidtransEnvironment", () => {
  it("treats SB-Mid keys as sandbox and everything else as production", () => {
    expect(getMidtransEnvironment("SB-Mid-client-abc")).toBe("sandbox");
    expect(getMidtransEnvironment("Mid-client-abc")).toBe("production");
    expect(getMidtransEnvironment("")).toBe("production");
    expect(getMidtransEnvironment(undefined)).toBe("production");
  });
});

describe("buildContentSecurityPolicy", () => {
  const sandbox = buildContentSecurityPolicy("SB-Mid-client-test");
  const production = buildContentSecurityPolicy("Mid-client-test");

  it("allows only sandbox Midtrans hosts for a sandbox key", () => {
    expect(directive(sandbox, "script-src")).toContain(
      "https://app.sandbox.midtrans.com"
    );
    expect(directive(sandbox, "frame-src")).toContain(
      "https://app.sandbox.midtrans.com"
    );
    expect(sandbox).not.toContain("https://app.midtrans.com");
  });

  it("allows only production Midtrans hosts for a production key", () => {
    expect(directive(production, "script-src")).toContain(
      "https://app.midtrans.com"
    );
    expect(directive(production, "frame-src")).toContain(
      "https://app.midtrans.com"
    );
    expect(production).not.toContain("sandbox");
  });

  it("defaults to production hosts when no key is configured", () => {
    const csp = buildContentSecurityPolicy(undefined);
    expect(csp).toContain("https://app.midtrans.com");
    expect(csp).not.toContain("sandbox");
  });

  it("reads NEXT_PUBLIC_MIDTRANS_CLIENT_KEY by default", () => {
    const original = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
    try {
      process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY = "SB-Mid-client-env";
      expect(buildContentSecurityPolicy()).toContain(
        "https://app.sandbox.midtrans.com"
      );
    } finally {
      if (original === undefined) {
        delete process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
      } else {
        process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY = original;
      }
    }
  });

  it("keeps frame-src restricted to self plus the one Midtrans host", () => {
    expect(directive(sandbox, "frame-src")).toEqual([
      "'self'",
      "https://app.sandbox.midtrans.com",
    ]);
    expect(directive(production, "frame-src")).toEqual([
      "'self'",
      "https://app.midtrans.com",
    ]);
  });

  it.each([
    ["sandbox", sandbox],
    ["production", production],
  ])("leaves the other directives unchanged (%s)", (_name, csp) => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com"
    );
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain(
      "connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io;"
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });
});
