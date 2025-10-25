import { Redis } from "@upstash/redis";

export type ThemeSuggestionPayload = {
  primary: string;
  accent: string;
  label: string;
  description: string;
  mode?: "light" | "dark";
};

const TTL_SECONDS = 60 * 60;

type MemoryEntry = {
  value: ThemeSuggestionPayload;
  expiresAt: number;
};

declare global {
  var __themeSuggestionCache__: Map<string, MemoryEntry> | undefined;
  var __themeSuggestionRedis__: Redis | null | undefined;
}

const memoryCache: Map<string, MemoryEntry> =
  globalThis.__themeSuggestionCache__ ?? new Map<string, MemoryEntry>();

globalThis.__themeSuggestionCache__ = memoryCache;

const resolveRedisClient = () => {
  if (typeof globalThis.__themeSuggestionRedis__ !== "undefined") {
    return globalThis.__themeSuggestionRedis__;
  }

  try {
    const client = Redis.fromEnv();
    globalThis.__themeSuggestionRedis__ = client;
    return client;
  } catch {
    globalThis.__themeSuggestionRedis__ = null;
    return null;
  }
};

export const buildCacheKey = (brand: string, mode: "light" | "dark", logoUrl?: string | null) => {
  const normalizedBrand = brand.trim().toLowerCase();
  const normalizedLogo = logoUrl?.trim().toLowerCase() ?? "";
  return `theme-suggest:${mode}:${normalizedBrand}:${normalizedLogo}`;
};

export const getCachedThemeSuggestion = async (key: string) => {
  const redis = resolveRedisClient();

  if (redis) {
    try {
      const cached = await redis.get<ThemeSuggestionPayload>(key);
      if (cached) {
        return cached;
      }
    } catch {
      // swallow redis errors and fallback to memory cache
    }
  }

  const entry = memoryCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt < Date.now()) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value;
};

export const setCachedThemeSuggestion = async (key: string, value: ThemeSuggestionPayload) => {
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  memoryCache.set(key, { value, expiresAt });

  const redis = resolveRedisClient();
  if (redis) {
    try {
      await redis.set(key, value, { ex: TTL_SECONDS });
    } catch {
      // ignore redis failure, memory cache already set
    }
  }
};
