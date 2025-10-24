import nextConfig from "@/next.config";
import { describe, expect, it } from "vitest";

describe("Security headers", () => {
  it("exposes required security headers on all routes", async () => {
    const headers = await nextConfig.headers?.();

    expect(headers).toBeDefined();
    expect(headers?.[0].source).toBe("/(.*)");

    const headerMap = new Map(headers?.[0].headers.map((header) => [header.key, header.value]));

    expect(headerMap.get("X-Frame-Options")).toBe("DENY");
    expect(headerMap.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headerMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerMap.get("Permissions-Policy")).toBe("geolocation=()");
  });
});
