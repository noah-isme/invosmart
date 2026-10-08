import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateCsrfToken,
  validateCsrfToken,
  verifyCsrfToken,
  getCsrfCookieOptions,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_PROTECTED_METHODS,
} from "../security/csrf";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Edge runtime compatibility", () => {
  it("does not import Node's crypto module or use Buffer", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../security/csrf.ts"),
      "utf-8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/from\s+["'](node:)?crypto["']/);
    expect(source).not.toMatch(/require\(\s*["'](node:)?crypto["']\s*\)/);
    expect(source).not.toMatch(/\bBuffer\./);
  });

  it("generates tokens through Web Crypto getRandomValues", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const token = generateCsrfToken();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0] as Uint8Array;
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(arg.length).toBe(32);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("zero-pads bytes when hex encoding", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((
      arr: Uint8Array
    ) => {
      arr.fill(1);
      arr[0] = 0;
      arr[31] = 255;
      return arr;
    }) as never);
    expect(generateCsrfToken()).toBe("00" + "01".repeat(30) + "ff");
  });
});

describe("CSRF cookie options", () => {
  it("is readable by same-origin JS, SameSite=Lax, and scoped to /", () => {
    const options = getCsrfCookieOptions();
    expect(options.httpOnly).toBe(false);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("is Secure only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getCsrfCookieOptions().secure).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    expect(getCsrfCookieOptions().secure).toBe(false);
  });

  it("protects exactly POST, PUT, PATCH and DELETE", () => {
    expect([...CSRF_PROTECTED_METHODS].sort()).toEqual([
      "DELETE",
      "PATCH",
      "POST",
      "PUT",
    ]);
  });
});

describe("CSRF Utility (lib/security/csrf.ts)", () => {
  describe("generateCsrfToken", () => {
    it("generates a 64-character hex string", () => {
      const token = generateCsrfToken();
      expect(typeof token).toBe("string");
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("generates unique tokens on subsequent invocations", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe("validateCsrfToken", () => {
    it("returns true for matching valid cookie and header tokens", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, token)).toBe(true);
    });

    it("returns false when cookie token is missing or null/undefined", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(undefined, token)).toBe(false);
      expect(validateCsrfToken(null, token)).toBe(false);
      expect(validateCsrfToken("", token)).toBe(false);
    });

    it("returns false when header token is missing or null/undefined", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, undefined)).toBe(false);
      expect(validateCsrfToken(token, null)).toBe(false);
      expect(validateCsrfToken(token, "")).toBe(false);
    });

    it("returns false when both tokens are missing", () => {
      expect(validateCsrfToken(undefined, undefined)).toBe(false);
      expect(validateCsrfToken(null, null)).toBe(false);
      expect(validateCsrfToken("", "")).toBe(false);
    });

    it("returns false for mismatched tokens of equal length", () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(validateCsrfToken(token1, token2)).toBe(false);
    });

    it("returns false for tokens of different lengths without throwing error", () => {
      const token = generateCsrfToken();
      expect(validateCsrfToken(token, "short-token")).toBe(false);
      expect(validateCsrfToken("short-token", token)).toBe(false);
    });

    it("compares multi-byte and prefix-related tokens correctly", () => {
      expect(validateCsrfToken("tokén-123", "tokén-123")).toBe(true);
      expect(validateCsrfToken("tokén-123", "token-123")).toBe(false);
      expect(validateCsrfToken("abc", "abcd")).toBe(false);
      expect(validateCsrfToken("abcd", "abc")).toBe(false);
    });

    it("trims surrounding whitespace before comparing", () => {
      expect(validateCsrfToken(" abc ", "abc")).toBe(true);
    });

    it("returns false for whitespace or empty strings", () => {
      expect(validateCsrfToken("   ", "   ")).toBe(false);
    });
  });

  describe("verifyCsrfToken", () => {
    it("returns true when request has matching cookie and x-csrf-token header", () => {
      const token = generateCsrfToken();
      const headers = new Headers();
      headers.set(CSRF_HEADER_NAME, token);
      headers.set("cookie", `${CSRF_COOKIE_NAME}=${token}`);

      const req = new Request("https://example.com/api/test", {
        method: "POST",
        headers,
      });

      expect(verifyCsrfToken(req)).toBe(true);
    });

    it("returns false when request has missing header or cookie", () => {
      const token = generateCsrfToken();
      const headers = new Headers();
      headers.set(CSRF_HEADER_NAME, token);

      const req = new Request("https://example.com/api/test", {
        method: "POST",
        headers,
      });

      expect(verifyCsrfToken(req)).toBe(false);
    });
  });
});
