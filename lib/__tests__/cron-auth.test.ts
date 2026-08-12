import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { requireCronAuthorization } from "@/lib/cron-auth";

describe("cron authorization", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("allows local development without a configured secret", () => {
    process.env = { ...originalEnv, NODE_ENV: "test" };
    expect(requireCronAuthorization(new NextRequest("http://localhost/api/cron/uptime"))).toBeNull();
  });

  it("fails closed in production when CRON_SECRET is absent", async () => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    const response = requireCronAuthorization(new NextRequest("http://localhost/api/cron/uptime"));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "Cron secret is not configured" });
  });

  it("requires a constant-time bearer header and rejects query-string secrets", () => {
    process.env = { ...originalEnv, NODE_ENV: "test", CRON_SECRET: "test-cron-secret" };

    expect(
      requireCronAuthorization(new NextRequest("http://localhost/api/cron/uptime?secret=test-cron-secret"))?.status,
    ).toBe(401);
    expect(
      requireCronAuthorization(new NextRequest("http://localhost/api/cron/uptime", {
        headers: { authorization: "Bearer wrong" },
      }))?.status,
    ).toBe(401);
    expect(
      requireCronAuthorization(new NextRequest("http://localhost/api/cron/uptime", {
        headers: { authorization: "Bearer test-cron-secret" },
      })),
    ).toBeNull();
  });
});
