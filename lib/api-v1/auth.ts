import type { NextRequest } from "next/server";

import { verifyApiKey, type ApiKeyScope } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/security";

import {
  apiError,
  getRequestId,
  type ApiErrorCode,
} from "@/lib/api-v1/http";
import {
  consumeApiRateLimit,
  isRateLimited,
  rateLimitHeaders,
  type ApiRateLimitState,
} from "@/lib/api-v1/rate-limit";

/**
 * Stable adapter contract consumed by `/api/v1` routes. The API-key module
 * currently supplies `organizationId`; `workspaceId` and `userId` are
 * accepted as aliases so a future key verifier can expose those names.
 */
export type ApiKeyIdentity = {
  keyId: string;
  workspaceId: string;
  userId?: string | null;
  scopes: readonly string[];
  expiresAt?: Date | null;
};

export type ApiRequestContext = {
  requestId: string;
  identity: ApiKeyIdentity;
  rateLimit: ApiRateLimitState;
};

const requestedWorkspaceId = (request: NextRequest) =>
  (request.nextUrl as { searchParams?: URLSearchParams } | undefined)?.searchParams?.get("organizationId") ||
  request.headers.get("x-organization-id") ||
  request.headers.get("x-workspace-id");

const isHttpsRequest = (request: NextRequest) => {
  if (process.env.NODE_ENV !== "production") return true;
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return !forwardedProto || forwardedProto.toLowerCase() === "https";
};

const authFailure = (
  requestId: string,
  code: ApiErrorCode,
  message: string,
  status: number,
  headers?: Record<string, string>,
) => apiError(code, message, { requestId, status, headers });

/** Verify the bearer key and normalize the key module's result. */
export const authenticateApiKey = async (
  request: NextRequest,
): Promise<ApiKeyIdentity | null> => {
  try {
    const result = await verifyApiKey(request.headers.get("authorization"));
    if (!result.ok || !result.apiKey) return null;
    return {
      keyId: result.apiKey.id,
      workspaceId: result.apiKey.organizationId,
      userId: result.apiKey.userId,
      scopes: result.apiKey.scopes,
      expiresAt: result.apiKey.expiresAt,
    };
  } catch {
    // Do not leak verifier/database failures as a 500 to unauthenticated users.
    return null;
  }
};

export const hasApiScope = (
  identity: ApiKeyIdentity,
  requiredScope: ApiKeyScope | string,
) => identity.scopes.includes(requiredScope) || identity.scopes.includes("*");

/** Authenticate, enforce transport/workspace constraints, and rate-limit. */
export const authorizeApiRequest = async (
  request: NextRequest,
  requiredScope: ApiKeyScope | string,
  bucket: string,
): Promise<{ ok: true; context: ApiRequestContext } | { ok: false; response: Response }> => {
  const requestId = getRequestId(request);

  if (!isHttpsRequest(request)) {
    return {
      ok: false,
      response: authFailure(requestId, "HTTPS_REQUIRED", "HTTPS is required for this endpoint", 403),
    };
  }

  const identity = await authenticateApiKey(request);
  const rateIdentifier = identity?.keyId || getClientIp(request);
  const rateLimit = consumeApiRateLimit(rateIdentifier, bucket);
  const rateHeaders = rateLimitHeaders(rateLimit);

  if (isRateLimited(rateLimit)) {
    return {
      ok: false,
      response: authFailure(
        requestId,
        "RATE_LIMITED",
        "Too many requests. Please try again later.",
        429,
        { ...rateHeaders, "retry-after": String(Math.max(1, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))) },
      ),
    };
  }

  if (!identity) {
    return {
      ok: false,
      response: authFailure(
        requestId,
        "UNAUTHORIZED",
        "A valid API key is required",
        401,
        { ...rateHeaders, "www-authenticate": "Bearer" },
      ),
    };
  }

  const requested = requestedWorkspaceId(request);
  if (requested && requested !== identity.workspaceId) {
    return {
      ok: false,
      response: authFailure(requestId, "FORBIDDEN", "Workspace access denied", 403, rateHeaders),
    };
  }

  if (!hasApiScope(identity, requiredScope)) {
    return {
      ok: false,
      response: authFailure(requestId, "FORBIDDEN", "API key scope does not allow this operation", 403, rateHeaders),
    };
  }

  return { ok: true, context: { requestId, identity, rateLimit } };
};

export const apiWorkspaceScope = (identity: ApiKeyIdentity) => ({
  organizationId: identity.workspaceId,
});

/**
 * Invoice/client rows retain a required `userId` for backwards compatibility.
 * Prefer the key creator when the database delegate exposes it; otherwise use
 * the oldest workspace membership as the acting owner. The API key itself is
 * still the authorization boundary for every resource query.
 */
export const resolveApiActorUserId = async (
  identity: ApiKeyIdentity,
): Promise<string | null> => {
  if (identity.userId) return identity.userId;

  const delegates = db as unknown as {
    apiKey?: {
      findUnique?: (args: unknown) => Promise<{ createdById?: string | null } | null | undefined>;
    };
  };

  try {
    const keyRecord = await delegates.apiKey?.findUnique?.({
      where: { id: identity.keyId },
      select: { createdById: true },
    });
    if (keyRecord?.createdById) return keyRecord.createdById;
  } catch {
    // Fall through to membership lookup for older generated clients.
  }

  try {
    const membership = await db.membership.findFirst({
      where: { organizationId: identity.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    }) as { userId?: string } | null | undefined;
    return membership?.userId ?? null;
  } catch {
    return null;
  }
};
