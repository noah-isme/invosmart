// Shared helpers for the /api/v1 specs (`api` project, request only).
//
// Verified against the code:
// - middleware.ts skips CSRF for /api/v1/* when Authorization is
//   `Bearer inv_live_...`; these requests come from a cookie-less request
//   context and carry no CSRF header.
// - lib/api-v1/auth.ts authorizeApiRequest(): HTTPS is not required for
//   localhost; the rate-limit identifier is the API key id when the key
//   verifies, else the client IP (lib/security.ts getClientIp: first
//   x-forwarded-for entry, then x-real-ip). Every request here gets a fresh
//   x-forwarded-for so unauthenticated (IP-keyed) calls never share a bucket.
import { randomUUID } from "node:crypto";

import type { APIRequestContext, APIResponse } from "@playwright/test";

import type { Guards } from "../../fixtures";
import { uniqueForwardedFor } from "../../support/auth";

export const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

export type V1Error = { error: { code: string; message: string }; requestId: string };
export type V1Success<T> = { data: T; meta?: { nextCursor: string | null; hasMore: boolean; limit: number }; requestId: string };

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export type V1Client = {
  fetch(
    method: Method,
    path: string,
    options?: { data?: unknown; idempotencyKey?: string; headers?: Record<string, string> },
  ): Promise<APIResponse>;
};

/**
 * A /api/v1 caller for `token` (or no Authorization at all when null) on a
 * cookie-less request context. Responses are fed to the guards so an
 * unexpected 429 still fails the test.
 */
export function v1Client(request: APIRequestContext, token: string | null, guards: Guards): V1Client {
  return {
    async fetch(method, path, { data, idempotencyKey, headers = {} } = {}) {
      const response = await request.fetch(path, {
        method,
        data,
        headers: {
          "x-forwarded-for": uniqueForwardedFor(),
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...headers,
        },
      });
      guards.checkApiResponse(response);
      return response;
    },
  };
}

/** A unique Idempotency-Key for this call. */
export const idempotencyKey = (tag: string) => `e2e-${tag}-${randomUUID()}`;

/** A unique display name for this call. */
export const uniqueName = (tag: string) => `E2E ${tag} ${randomUUID().slice(0, 8)}`;

export async function errorCode(response: APIResponse): Promise<string> {
  return ((await response.json()) as V1Error).error.code;
}
