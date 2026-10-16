import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: queryRaw },
}));

import { GET } from "@/app/api/health/route";
import { clearRateLimiters } from "@/lib/rate-limit";

const health = (query = "", ip = "203.0.113.7") =>
  GET(new NextRequest(`http://localhost:3000/api/health${query}`, { headers: { "x-forwarded-for": ip } }));

describe("GET /api/health", () => {
  beforeEach(() => {
    clearRateLimiters();
    queryRaw.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("answers 200 without touching the database when db=1 is absent", async () => {
    const response = await health();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", timestamp: expect.any(String) });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("pings the database and reports checks.db ok with db=1", async () => {
    queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await health("?db=1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", checks: { db: "ok" }, timestamp: expect.any(String) });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("answers 503 degraded without the error message when the ping rejects", async () => {
    queryRaw.mockRejectedValue(new Error("connection refused at 10.0.0.5:5432"));

    const response = await health("?db=1");
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "degraded", checks: { db: "error" }, timestamp: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });

  it("answers 503 within the 2 s timeout when the ping hangs", async () => {
    vi.useFakeTimers();
    queryRaw.mockReturnValue(new Promise(() => {}));

    const pending = health("?db=1");
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect((await response.json()).checks).toEqual({ db: "error" });
  });

  it("rate limits db=1 per IP (11th call -> 429) while the bare check stays 200", async () => {
    queryRaw.mockResolvedValue([]);

    for (let i = 0; i < 10; i += 1) {
      expect((await health("?db=1")).status).toBe(200);
    }
    const limited = await health("?db=1");

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect((await health()).status).toBe(200);
    expect(queryRaw).toHaveBeenCalledTimes(10);
  });
});
