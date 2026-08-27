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

/**
 * A process-local guard for the beta API. The key verifier can replace this
 * with a distributed implementation later without changing route contracts.
 */
export const consumeApiRateLimit = (
  identifier: string,
  bucket: string,
  limit = DEFAULT_LIMIT,
  now = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
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

export const isRateLimited = (state: ApiRateLimitState) => state.remaining <= 0;

export const rateLimitHeaders = (state: ApiRateLimitState) => ({
  "x-ratelimit-limit": String(state.limit),
  "x-ratelimit-remaining": String(Math.max(0, state.remaining)),
  "x-ratelimit-reset": String(Math.ceil(state.resetAt / 1000)),
});

export const clearApiRateLimits = () => entries.clear();
