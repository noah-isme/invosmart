import crypto from "node:crypto";

import type { Redis } from "@upstash/redis";

import { getApiRedis } from "@/lib/api-v1/redis";

export type IdempotentResult<T> = {
  status: number;
  data: T;
};

export type IdempotencyOutcome<T> = {
  kind: "executed" | "replayed" | "conflict" | "in_progress" | "unavailable";
  result?: IdempotentResult<T>;
};

type Entry<T> = {
  fingerprint: string;
  promise: Promise<IdempotentResult<T>>;
  createdAt: number;
};

type StoredRecord<T> =
  | { state: "pending"; fingerprint: string; owner: string }
  | { state: "completed"; fingerprint: string; result: IdempotentResult<T> };

const entries = new Map<string, Entry<unknown>>();
const ENTRY_TTL_MS = 24 * 60 * 60_000; // 24 hours
const MAX_ENTRIES = 5_000;
const EVICTION_INTERVAL_MS = 60_000;

// Must exceed the create routes' `maxDuration` so a claim cannot lapse while
// its owner is still running; if the owner dies mid-write the key frees itself
// instead of blocking retries for the full result TTL.
const PENDING_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = ENTRY_TTL_MS / 1000;
const WAIT_TIMEOUT_MS = 5_000;
const WAIT_INTERVAL_MS = 150;

let lastEviction = Date.now();

/** Remove expired entries to prevent unbounded memory growth. */
const evictExpired = (now: number): void => {
  if (now - lastEviction < EVICTION_INTERVAL_MS) return;
  lastEviction = now;
  for (const [key, entry] of entries) {
    if (now - entry.createdAt > ENTRY_TTL_MS) entries.delete(key);
  }
  if (entries.size > MAX_ENTRIES) {
    const overflow = entries.size - MAX_ENTRIES;
    const keys = entries.keys();
    for (let i = 0; i < overflow; i++) {
      const next = keys.next();
      if (!next.done) entries.delete(next.value);
    }
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
};

export const requestFingerprint = (value: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const executeLocally = async <T>(
  storeKey: string,
  fingerprint: string,
  operation: () => Promise<IdempotentResult<T>>,
): Promise<IdempotencyOutcome<T>> => {
  evictExpired(Date.now());
  const existing = entries.get(storeKey);

  if (existing) {
    if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
    return { kind: "replayed", result: (await existing.promise) as IdempotentResult<T> };
  }

  const promise = operation();
  entries.set(storeKey, { fingerprint, promise: promise as Promise<IdempotentResult<unknown>>, createdAt: Date.now() });

  try {
    return { kind: "executed", result: await promise };
  } catch (error) {
    entries.delete(storeKey);
    throw error;
  }
};

/**
 * Claim the key with SET NX so exactly one instance runs the operation. Other
 * instances wait briefly for the stored result and report `in_progress` if the
 * owner is still running. A failed operation releases the claim so the client
 * can retry with the same key, matching the process-local behaviour.
 *
 * If Redis cannot be reached the outcome is `unavailable`: without the shared
 * record there is no way to know whether another instance is already running
 * this request, and a retryable 503 is better than a duplicate write.
 */
const executeWithRedis = async <T>(
  redis: Redis,
  redisKey: string,
  fingerprint: string,
  operation: () => Promise<IdempotentResult<T>>,
): Promise<IdempotencyOutcome<T>> => {
  const owner = crypto.randomUUID();
  const pending: StoredRecord<T> = { state: "pending", fingerprint, owner };
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  for (;;) {
    let claimed: boolean;
    let record: StoredRecord<T> | null = null;
    try {
      claimed = Boolean(await redis.set(redisKey, pending, { nx: true, ex: PENDING_TTL_SECONDS }));
      if (!claimed) {
        record = await redis.get<StoredRecord<T>>(redisKey);
        // A retried SET whose first attempt landed reports our own claim as taken.
        claimed = record?.state === "pending" && record.owner === owner;
      }
    } catch (error) {
      console.warn("[api-v1] Redis idempotency store unavailable; refusing the request.", error);
      return { kind: "unavailable" };
    }

    if (claimed) {
      let result: IdempotentResult<T>;
      try {
        result = await operation();
      } catch (error) {
        await redis.del(redisKey).catch(() => undefined);
        throw error;
      }

      const completed: StoredRecord<T> = { state: "completed", fingerprint, result };
      await redis.set(redisKey, completed, { ex: RESULT_TTL_SECONDS }).catch((error: unknown) => {
        console.warn("[api-v1] Failed to persist idempotent result; retries after the pending claim expires may re-run.", error);
      });
      return { kind: "executed", result };
    }

    // A missing record means the owner failed and released the key; loop to claim it.
    if (record) {
      if (record.fingerprint !== fingerprint) return { kind: "conflict" };
      if (record.state === "completed") return { kind: "replayed", result: record.result };
    }

    if (Date.now() >= deadline) return { kind: "in_progress" };
    await sleep(WAIT_INTERVAL_MS);
  }
};

export const executeIdempotently = async <T>(input: {
  workspaceId: string;
  namespace: string;
  key: string;
  body: unknown;
  operation: () => Promise<IdempotentResult<T>>;
}): Promise<IdempotencyOutcome<T>> => {
  const storeKey = `${input.workspaceId}:${input.namespace}:${input.key}`;
  const fingerprint = requestFingerprint(input.body);

  const redis = getApiRedis();
  if (redis) {
    return executeWithRedis(redis, `api-v1:idempotency:${storeKey}`, fingerprint, input.operation);
  }

  return executeLocally(storeKey, fingerprint, input.operation);
};

export const clearIdempotencyStore = () => entries.clear();
