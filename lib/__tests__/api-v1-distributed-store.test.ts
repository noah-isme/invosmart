import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearIdempotencyStore,
  executeIdempotently,
  type IdempotentResult,
} from "@/lib/api-v1/idempotency";
import {
  clearApiRateLimits,
  consumeApiRateLimit,
  isRateLimited,
} from "@/lib/api-v1/rate-limit";
import { FakeRedis } from "@/test/mocks/fake-redis";

const { redisRef } = vi.hoisted(() => ({
  redisRef: { current: null as unknown },
}));

vi.mock("@/lib/api-v1/redis", () => ({
  getApiRedis: () => redisRef.current,
}));

const base = {
  workspaceId: "org-a",
  namespace: "POST:/api/v1/invoices",
  key: "create-1",
  body: { client: "Acme", items: [{ name: "Work", qty: 1, price: 100 }] },
};

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
  redisRef.current = redis;
  clearIdempotencyStore();
  clearApiRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("api-v1 idempotency with Redis", () => {
  it("replays a stored result on another instance without re-running the operation", async () => {
    const operation = vi.fn(async () => ({
      status: 201,
      data: { id: "inv-1", createdAt: new Date("2026-10-03T00:00:00.000Z") },
    }));

    const first = await executeIdempotently({ ...base, operation });
    clearIdempotencyStore(); // another instance has no process-local state
    const second = await executeIdempotently({ ...base, operation });

    expect(first.kind).toBe("executed");
    expect(second).toEqual({
      kind: "replayed",
      result: { status: 201, data: { id: "inv-1", createdAt: "2026-10-03T00:00:00.000Z" } },
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused key with a different payload", async () => {
    await executeIdempotently({ ...base, operation: async () => ({ status: 201, data: { id: "inv-1" } }) });
    const operation = vi.fn();

    const result = await executeIdempotently({ ...base, body: { client: "Other" }, operation });

    expect(result).toEqual({ kind: "conflict" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("releases the key when the operation fails so a retry can run", async () => {
    await expect(executeIdempotently({
      ...base,
      operation: async () => {
        throw new Error("Client not found");
      },
    })).rejects.toThrow("Client not found");

    const retry = await executeIdempotently({ ...base, operation: async () => ({ status: 201, data: { id: "inv-1" } }) });

    expect(retry).toEqual({ kind: "executed", result: { status: 201, data: { id: "inv-1" } } });
  });

  it("waits for an in-flight request on another instance and replays its result", async () => {
    let release!: (value: IdempotentResult<{ id: string }>) => void;
    const slow = vi.fn(() => new Promise<IdempotentResult<{ id: string }>>((resolve) => {
      release = resolve;
    }));
    const duplicate = vi.fn();

    const first = executeIdempotently({ ...base, operation: slow });
    const second = executeIdempotently({ ...base, operation: duplicate });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release({ status: 201, data: { id: "inv-1" } });

    await expect(first).resolves.toMatchObject({ kind: "executed" });
    await expect(second).resolves.toEqual({ kind: "replayed", result: { status: 201, data: { id: "inv-1" } } });
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("reports in_progress when the owner does not finish within the wait window", async () => {
    vi.useFakeTimers();
    void executeIdempotently({ ...base, operation: () => new Promise<never>(() => undefined) });
    const duplicate = vi.fn();

    const second = executeIdempotently({ ...base, operation: duplicate });
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(second).resolves.toEqual({ kind: "in_progress" });
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("fails closed when Redis is unreachable instead of using a process-local store", async () => {
    redis.failing = true;
    const operation = vi.fn();

    const result = await executeIdempotently({ ...base, operation });

    expect(result).toEqual({ kind: "unavailable" });
    expect(operation).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("refuses rather than duplicating when Redis fails while another instance holds the key", async () => {
    void executeIdempotently({ ...base, operation: () => new Promise<never>(() => undefined) });
    await Promise.resolve();
    vi.spyOn(redis, "get").mockRejectedValueOnce(new Error("redis unavailable"));
    const duplicate = vi.fn();

    const result = await executeIdempotently({ ...base, operation: duplicate });

    expect(result).toEqual({ kind: "unavailable" });
    expect(duplicate).not.toHaveBeenCalled();
  });

  it("recognises its own claim when a retried SET reports the key as taken", async () => {
    const realSet = redis.set.bind(redis);
    vi.spyOn(redis, "set").mockImplementationOnce(async (key, value, options) => {
      await realSet(key, value, options); // first attempt landed, response was lost
      return null;
    });
    const operation = vi.fn(async () => ({ status: 201, data: { id: "inv-1" } }));

    const result = await executeIdempotently({ ...base, operation });

    expect(result).toEqual({ kind: "executed", result: { status: 201, data: { id: "inv-1" } } });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("api-v1 rate limit with Redis", () => {
  it("shares a clock-aligned window across instances", async () => {
    const now = 125_000; // inside the 120s–180s window

    const a = await consumeApiRateLimit("key-a", "invoices:list", 2, now);
    clearApiRateLimits(); // another instance has no process-local counter
    const b = await consumeApiRateLimit("key-a", "invoices:list", 2, now + 1_000);
    const c = await consumeApiRateLimit("key-a", "invoices:list", 2, now + 2_000);
    const nextWindow = await consumeApiRateLimit("key-a", "invoices:list", 2, 180_000);

    expect([a.remaining, b.remaining, c.remaining]).toEqual([1, 0, -1]);
    expect(isRateLimited(c)).toBe(true);
    expect(a.resetAt).toBe(180_000);
    expect(nextWindow.remaining).toBe(1);
  });

  it("keeps separate counters per bucket and identifier", async () => {
    await consumeApiRateLimit("key-a", "invoices:list", 2, 0);

    const otherKey = await consumeApiRateLimit("key-b", "invoices:list", 2, 0);
    const otherBucket = await consumeApiRateLimit("key-a", "clients:list", 2, 0);

    expect(otherKey.remaining).toBe(1);
    expect(otherBucket.remaining).toBe(1);
  });

  it("falls back to a process-local window when Redis is unreachable", async () => {
    redis.failing = true;

    const first = await consumeApiRateLimit("key-a", "invoices:list", 2, 1_000);
    const second = await consumeApiRateLimit("key-a", "invoices:list", 2, 1_500);

    expect([first.remaining, second.remaining]).toEqual([1, 0]);
    expect(first.resetAt).toBe(61_000);
    expect(console.warn).toHaveBeenCalled();
  });

  it("uses the process-local window when Redis is not configured", async () => {
    redisRef.current = null;

    const first = await consumeApiRateLimit("key-a", "invoices:list", 2, 1_000);
    const second = await consumeApiRateLimit("key-a", "invoices:list", 2, 1_500);

    expect([first.remaining, second.remaining]).toEqual([1, 0]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
