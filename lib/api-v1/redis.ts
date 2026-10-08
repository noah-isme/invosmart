import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

const REQUEST_TIMEOUT_MS = 1_000;

/**
 * Shared Upstash client for `/api/v1` state that must hold across serverless
 * instances (rate limits and idempotency keys). Returns null when Redis is not
 * configured so local development and tests fall back to process-local stores.
 */
export const getApiRedis = (): Redis | null => {
  if (client !== undefined) return client;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      console.warn("[api-v1] Upstash Redis is not configured; rate limits and idempotency keys are process-local.");
    }
    client = null;
    return client;
  }

  client = new Redis({
    url,
    token,
    // Fail fast so callers can degrade or answer 503 within the function budget
    // instead of sitting through the client's default ~4s retry backoff.
    retry: { retries: 1, backoff: () => 100 },
    // A signal factory (not a shared signal) makes the client throw on timeout
    // rather than returning a fabricated successful response.
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return client;
};
