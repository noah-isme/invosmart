import type { NextRequest } from "next/server";

import { getClientIp } from "@/lib/security";

type RateLimitEntry = {
  count: number;
  expiresAt: number;
};

const limiter = new Map<string, RateLimitEntry>();
const limitWindow = 60_000;
const maxRequests = 10;

const createKey = (bucket: string, ip: string) => `${bucket}:${ip}`;

const resetEntry = (key: string, now: number) => {
  limiter.set(key, { count: 1, expiresAt: now + limitWindow });
};

const incrementEntry = (key: string, entry: RateLimitEntry) => {
  entry.count += 1;
  limiter.set(key, entry);
};

export const rateLimit = (
  request: NextRequest,
  bucket: string,
): Response | null => {
  const ip = getClientIp(request);
  const now = Date.now();
  const key = createKey(bucket, ip);
  const entry = limiter.get(key);

  if (!entry || entry.expiresAt <= now) {
    resetEntry(key, now);
    return null;
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
    return (globalThis as any).NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": retryAfter.toString(),
        },
      },
    );
  }

  incrementEntry(key, entry);
  return null;
};

export const clearRateLimiters = () => limiter.clear();
