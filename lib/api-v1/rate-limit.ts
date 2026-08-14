export type ApiRateLimitState = {
  limit: number;
  remaining: number;
  resetAt: number;
};

type Entry = { count: number; resetAt: number };

const entries = new Map<string, Entry>();
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

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

export const isRateLimited = (state: ApiRateLimitState) => state.remaining < 0;

export const rateLimitHeaders = (state: ApiRateLimitState) => ({
  "x-ratelimit-limit": String(state.limit),
  "x-ratelimit-remaining": String(Math.max(0, state.remaining)),
  "x-ratelimit-reset": String(Math.ceil(state.resetAt / 1000)),
});

export const clearApiRateLimits = () => entries.clear();
