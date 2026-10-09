// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// The main Vitest config aliases every `next-auth/*` import to a mock path;
// auth.ts only needs `encode` at call time, which this test never makes.
vi.mock("next-auth/jwt", () => ({ encode: vi.fn() }));

import { getCsrfCookieName } from "@/lib/security/csrf";
import { E2E_CSRF_COOKIE, uniqueForwardedFor } from "./auth";

describe("e2e auth support", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("E2E_CSRF_COOKIE matches the cookie the production app issues", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(E2E_CSRF_COOKIE).toBe(getCsrfCookieName());
  });

  it("uniqueForwardedFor returns a fresh IPv4 value on every call", () => {
    const values = Array.from({ length: 300 }, () => uniqueForwardedFor());
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });
});
