import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfFetch, getCsrfTokenFromCookie } from "../security/csrf-client";
import {
  getCsrfCookieName,
  CSRF_HEADER_NAME,
  LEGACY_CSRF_COOKIE_NAME,
} from "../security/csrf";

function setCookie(value: string) {
  document.cookie = `${value}; path=/`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

describe("csrf-client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearCookie(getCsrfCookieName());
    clearCookie("other");
    vi.unstubAllGlobals();
  });

  function sentHeaders(): Headers {
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    return new Headers(init.headers);
  }

  describe("getCsrfTokenFromCookie", () => {
    it("returns null when the cookie is absent", () => {
      expect(getCsrfTokenFromCookie()).toBeNull();
    });

    it("reads the token among other cookies", () => {
      setCookie("other=1");
      setCookie(`${getCsrfCookieName()}=abc123`);
      expect(getCsrfTokenFromCookie()).toBe("abc123");
    });

    it("does not match cookies whose name merely ends with the CSRF name", () => {
      setCookie(`x-${getCsrfCookieName()}=evil`);
      expect(getCsrfTokenFromCookie()).toBeNull();
      clearCookie(`x-${getCsrfCookieName()}`);
    });

    it("reads the rotated cookie name and ignores the legacy csrf-token cookie", () => {
      setCookie(`${LEGACY_CSRF_COOKIE_NAME}=legacy`);
      expect(getCsrfTokenFromCookie()).toBeNull();

      setCookie(`${getCsrfCookieName()}=fresh`);
      expect(getCsrfTokenFromCookie()).toBe("fresh");
      clearCookie(LEGACY_CSRF_COOKIE_NAME);
    });

    it("reads the __Host- cookie in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      const cookieSpy = vi
        .spyOn(document, "cookie", "get")
        .mockReturnValue("a=1; __Host-csrf-token=prod-token; csrf-token=legacy");
      expect(getCsrfTokenFromCookie()).toBe("prod-token");
      cookieSpy.mockRestore();
      vi.unstubAllEnvs();
    });

    it("decodes percent-encoded values", () => {
      setCookie(`${getCsrfCookieName()}=a%2Bb`);
      expect(getCsrfTokenFromCookie()).toBe("a+b");
    });
  });

  describe("csrfFetch", () => {
    it.each(["POST", "PUT", "PATCH", "DELETE", "post"])(
      "adds the token header to same-origin %s requests",
      async (method) => {
        setCookie(`${getCsrfCookieName()}=tok`);
        await csrfFetch("/api/invoices", { method, body: "{}" });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe("/api/invoices");
        expect(sentHeaders().get(CSRF_HEADER_NAME)).toBe("tok");
        expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe("{}");
      }
    );

    it("preserves existing headers", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const headers = sentHeaders();
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get(CSRF_HEADER_NAME)).toBe("tok");
    });

    it("preserves headers supplied as a Headers instance or tuple array", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch("/api/a", { method: "POST", headers: new Headers({ "x-a": "1" }) });
      expect(sentHeaders().get("x-a")).toBe("1");

      fetchMock.mockClear();
      await csrfFetch("/api/b", { method: "POST", headers: [["x-b", "2"]] });
      expect(sentHeaders().get("x-b")).toBe("2");
      expect(sentHeaders().get(CSRF_HEADER_NAME)).toBe("tok");
    });

    it("does not overwrite an explicitly supplied token header", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch("/api/invoices", {
        method: "POST",
        headers: { [CSRF_HEADER_NAME]: "explicit" },
      });
      expect(sentHeaders().get(CSRF_HEADER_NAME)).toBe("explicit");
    });

    it("does not add the header to safe methods", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch("/api/invoices");
      await csrfFetch("/api/invoices", { method: "GET" });
      await csrfFetch("/api/invoices", { method: "HEAD" });
      for (const call of fetchMock.mock.calls) {
        const init = call[1] as RequestInit | undefined;
        expect(new Headers(init?.headers).has(CSRF_HEADER_NAME)).toBe(false);
      }
    });

    it("never sends the token to a different origin", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch("https://evil.example.com/api/invoices", { method: "POST" });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).has(CSRF_HEADER_NAME)).toBe(false);
    });

    it("adds the token for absolute same-origin URLs and URL objects", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      await csrfFetch(`${window.location.origin}/api/invoices`, { method: "POST" });
      expect(sentHeaders().get(CSRF_HEADER_NAME)).toBe("tok");

      fetchMock.mockClear();
      await csrfFetch(new URL("/api/invoices", window.location.href), { method: "DELETE" });
      expect(sentHeaders().get(CSRF_HEADER_NAME)).toBe("tok");
    });

    it("uses the method and headers of a Request input", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      const request = new Request(`${window.location.origin}/api/invoices`, {
        method: "PUT",
        headers: { "x-keep": "yes" },
      });
      await csrfFetch(request);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(headers.get(CSRF_HEADER_NAME)).toBe("tok");
      expect(headers.get("x-keep")).toBe("yes");
    });

    it("passes arguments through unchanged when no token cookie exists", async () => {
      const init = { method: "POST", body: "{}" };
      await csrfFetch("/api/invoices", init);
      expect(fetchMock).toHaveBeenCalledWith("/api/invoices", init);
    });

    it("returns the underlying fetch response", async () => {
      setCookie(`${getCsrfCookieName()}=tok`);
      const response = await csrfFetch("/api/invoices", { method: "POST" });
      expect(response.status).toBe(200);
    });
  });
});
