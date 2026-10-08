import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  getMidtransEnvironment,
  getSnapScriptUrl,
} from "@/lib/security/csp";

const EXPECTED_SANDBOX_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com https://app.sandbox.midtrans.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io",
  "frame-src 'self' https://app.sandbox.midtrans.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const EXPECTED_PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://app.posthog.com https://app.midtrans.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://app.posthog.com https://*.ingest.sentry.io",
  "frame-src 'self' https://app.midtrans.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

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

  it("produces exactly the expected sandbox policy", () => {
    expect(sandbox).toBe(EXPECTED_SANDBOX_CSP);
  });

  it("produces exactly the expected production policy", () => {
    expect(production).toBe(EXPECTED_PRODUCTION_CSP);
  });
});

describe("getSnapScriptUrl", () => {
  it("returns the sandbox snap.js URL for SB-Mid keys", () => {
    expect(getSnapScriptUrl("SB-Mid-client-test")).toBe(
      "https://app.sandbox.midtrans.com/snap/snap.js"
    );
  });

  it("returns the production snap.js URL for other or missing keys", () => {
    expect(getSnapScriptUrl("Mid-client-test")).toBe(
      "https://app.midtrans.com/snap/snap.js"
    );
    expect(getSnapScriptUrl(undefined)).toBe(
      "https://app.midtrans.com/snap/snap.js"
    );
  });

  it("loads snap.js from the same origin the CSP allows in script-src", () => {
    for (const key of ["SB-Mid-client-test", "Mid-client-test"]) {
      const origin = new URL(getSnapScriptUrl(key)).origin;
      expect(directive(buildContentSecurityPolicy(key), "script-src")).toContain(
        origin
      );
    }
  });
});
