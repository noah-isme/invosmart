import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearApiRateLimits,
  consumeApiRateLimit,
  isRateLimited,
  rateLimitHeaders,
} from "@/lib/api-v1/rate-limit";
import { clearRateLimiters, rateLimit } from "@/lib/rate-limit";
import { FakeRedis } from "@/test/mocks/fake-redis";

const { redisRef } = vi.hoisted(() => ({
  redisRef: { current: null as unknown },
}));

vi.mock("@/lib/api-v1/redis", () => ({
  getApiRedis: () => redisRef.current,
}));

beforeEach(() => {
  redisRef.current = null;
  clearApiRateLimits();
  clearRateLimiters();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sendApiRequests = async (count: number, limit: number) => {
  const states = [];
  for (let i = 0; i < count; i += 1) {
    states.push(await consumeApiRateLimit("key-a", "invoices:list", limit, 1_000 + i));
  }
  return states;
};

describe("api-v1 rate limit boundary", () => {
  it.each([
    ["process-local", () => null],
    ["Redis", () => new FakeRedis()],
  ])("admits exactly `limit` requests per window and refuses the next (%s)", async (_name, makeRedis) => {
    redisRef.current = makeRedis();
    const limit = 3;
    const states = await sendApiRequests(limit + 1, limit);

    expect(states.map(isRateLimited)).toEqual([false, false, false, true]);
    expect(states.map((state) => rateLimitHeaders(state)["x-ratelimit-remaining"])).toEqual(["2", "1", "0", "0"]);
    expect(rateLimitHeaders(states[limit])["x-ratelimit-limit"]).toBe(String(limit));
  });

  it("admits 120 requests with the default limit", async () => {
    const states = [];
    for (let i = 0; i < 121; i += 1) {
      states.push(await consumeApiRateLimit("key-b", "invoices:list", undefined, 1_000));
    }
    expect(states.slice(0, 120).every((state) => !isRateLimited(state))).toBe(true);
    expect(states[119].limit).toBe(120);
    expect(states[119].remaining).toBe(0);
    expect(isRateLimited(states[120])).toBe(true);
  });
});

describe("app rate limit boundary (lib/rate-limit.ts)", () => {
  it("admits 10 requests per bucket and IP and answers 429 for the 11th", () => {
    const request = () =>
      new NextRequest("http://localhost/api/clients", { headers: { "x-forwarded-for": "10.0.0.7" } });
    const results = Array.from({ length: 11 }, () => rateLimit(request(), "clients"));

    expect(results.slice(0, 10).every((result) => result === null)).toBe(true);
    expect(results[10]?.status).toBe(429);
    expect(Number(results[10]?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});
