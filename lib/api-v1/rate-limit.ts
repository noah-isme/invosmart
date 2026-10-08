import type { Redis } from "@upstash/redis";

import { getApiRedis } from "@/lib/api-v1/redis";

export type ApiRateLimitState = {
  limit: number;
  remaining: number;
  resetAt: number;
};

type Entry = { count: number; resetAt: number };

const entries = new Map<string, Entry>();
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;
const MAX_ENTRIES = 10_000;
const EVICTION_INTERVAL_MS = 60_000;

let lastEviction = Date.now();

/** Remove expired entries to prevent unbounded memory growth. */
const evictExpired = (now: number): void => {
  if (now - lastEviction < EVICTION_INTERVAL_MS) return;
  lastEviction = now;
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) entries.delete(key);
  }
  // Hard cap: if still over limit after TTL eviction, drop oldest entries
  if (entries.size > MAX_ENTRIES) {
    const overflow = entries.size - MAX_ENTRIES;
    const keys = entries.keys();
    for (let i = 0; i < overflow; i++) {
      const next = keys.next();
      if (!next.done) entries.delete(next.value);
    }
  }
};

const consumeLocal = (
  identifier: string,
  bucket: string,
  limit: number,
  now: number,
  windowMs: number,
): ApiRateLimitState => {
  evictExpired(now);

  const mapKey = `${bucket}:${identifier}`;
  const existing = entries.get(mapKey);
  const entry = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;

  entry.count += 1;
  entries.set(mapKey, entry);

  return {
    limit,
    remaining: limit - entry.count,
    resetAt: entry.resetAt,
  };
};

/**
 * Fixed window aligned to the clock, so every instance agrees on the window
 * without reading a TTL back. The key embeds the window index, so refreshing
 * its expiry on every hit is harmless and avoids a separate first-hit branch.
 */
const consumeDistributed = async (
  redis: Redis,
  identifier: string,
  bucket: string,
  limit: number,
  now: number,
  windowMs: number,
): Promise<ApiRateLimitState> => {
  const window = Math.floor(now / windowMs);
  const key = `api-v1:ratelimit:${bucket}:${identifier}:${window}`;
  const [count] = await redis.pipeline().incr(key).pexpire(key, windowMs * 2).exec<[number, number]>();

  return {
    limit,
    remaining: limit - Number(count),
    resetAt: (window + 1) * windowMs,
  };
};

/**
 * Counts requests in Redis when it is configured so the limit holds across
 * serverless instances. Falls back to a process-local window when Redis is
 * absent or unreachable rather than failing the request.
 */
export const consumeApiRateLimit = async (
  identifier: string,
  bucket: string,
  limit = DEFAULT_LIMIT,
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
): Promise<ApiRateLimitState> => {
  const redis = getApiRedis();
  if (redis) {
    try {
      return await consumeDistributed(redis, identifier, bucket, limit, now, windowMs);
    } catch (error) {
      console.warn("[api-v1] Redis rate limit unavailable; using process-local window.", error);
    }
  }

  return consumeLocal(identifier, bucket, limit, now, windowMs);
};

export const isRateLimited = (state: ApiRateLimitState) => state.remaining <= 0;

export const rateLimitHeaders = (state: ApiRateLimitState) => ({
  "x-ratelimit-limit": String(state.limit),
  "x-ratelimit-remaining": String(Math.max(0, state.remaining)),
  "x-ratelimit-reset": String(Math.ceil(state.resetAt / 1000)),
});

export const clearApiRateLimits = () => entries.clear();
