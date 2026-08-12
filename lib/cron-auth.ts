import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const sameSecret = (provided: string, expected: string) => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
};

/**
 * Protects scheduled endpoints with the platform's Authorization header.
 *
 * Local development remains usable without CRON_SECRET. Production fails
 * closed when the secret is missing, and query-string secrets are rejected so
 * they cannot leak through logs, referrers, or analytics.
 */
export const requireCronAuthorization = (request: NextRequest) => {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) {
    return process.env.NODE_ENV === "production"
      ? NextResponse.json({ error: "Cron secret is not configured" }, { status: 503 })
      : null;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match || !sameSecret(match[1], configuredSecret)) return unauthorized();
  return null;
};
