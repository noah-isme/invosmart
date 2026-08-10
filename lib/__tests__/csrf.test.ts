import { describe, expect, it } from "vitest";
import {
  generateCsrfToken,
  validateCsrfToken,
  verifyCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../security/csrf";

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
