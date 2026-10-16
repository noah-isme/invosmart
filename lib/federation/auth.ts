import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest();

// Hash both sides so the buffers always have equal length (timingSafeEqual
// throws otherwise) and the comparison does not leak the secret's length.
const bearerMatchesSecret = (header: string, secret: string) => {
  if (!/^bearer\s/i.test(header)) return false;
  const token = header.slice("bearer".length).trim();
  if (!token) return false;
  return timingSafeEqual(sha256(token), sha256(secret));
};

let warnedMissingSecret = false;

/**
 * Peer authentication for the federation endpoints: a constant-time compare of
 * the `Authorization: Bearer` header against FEDERATION_TOKEN_SECRET.
 *
 * Returns null when the bearer matches. Fails closed otherwise: 503 when the
 * secret is unset in production, 401 on a missing or wrong bearer (and when the
 * secret is unset outside production). There is no session fallback here;
 * routes that also accept platform-admin sessions check those themselves.
 */
export const requireFederationBearer = (request: Request) => {
  const secret = process.env.FEDERATION_TOKEN_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true;
        console.warn(
          "[security] FEDERATION_TOKEN_SECRET is not set: federation peer bearer auth is disabled (fail closed).",
        );
      }
      return NextResponse.json({ error: "Federation is not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  if (!bearerMatchesSecret(request.headers.get("authorization") ?? "", secret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  return null;
};
