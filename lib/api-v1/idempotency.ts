import crypto from "node:crypto";

export type IdempotentResult<T> = {
  status: number;
  data: T;
};

type Entry<T> = {
  fingerprint: string;
  promise: Promise<IdempotentResult<T>>;
  createdAt: number;
};

const entries = new Map<string, Entry<unknown>>();
const ENTRY_TTL_MS = 24 * 60 * 60_000; // 24 hours
const MAX_ENTRIES = 5_000;
const EVICTION_INTERVAL_MS = 60_000;

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

export const executeIdempotently = async <T>(input: {
  workspaceId: string;
  namespace: string;
  key: string;
  body: unknown;
  operation: () => Promise<IdempotentResult<T>>;
}): Promise<{ kind: "executed" | "replayed" | "conflict"; result?: IdempotentResult<T> }> => {
  const mapKey = `${input.workspaceId}:${input.namespace}:${input.key}`;
  const fingerprint = requestFingerprint(input.body);
  evictExpired(Date.now());
  const existing = entries.get(mapKey);

  if (existing) {
    if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
    return { kind: "replayed", result: (await existing.promise) as IdempotentResult<T> };
  }

  const promise = input.operation();
  entries.set(mapKey, { fingerprint, promise: promise as Promise<IdempotentResult<unknown>>, createdAt: Date.now() });

  try {
    return { kind: "executed", result: await promise };
  } catch (error) {
    entries.delete(mapKey);
    throw error;
  }
};

export const clearIdempotencyStore = () => entries.clear();
