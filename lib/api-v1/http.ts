import { NextResponse } from "next/server";

/** A small, stable error shape shared by every versioned API route. */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_JSON"
  | "INVALID_CURSOR"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "HTTPS_REQUIRED"
  | "INTERNAL_ERROR";

export type ApiResponseInit = {
  requestId: string;
  status?: number;
  headers?: Record<string, string>;
};

const REQUEST_ID_MAX_LENGTH = 128;

/**
 * Keep a caller supplied request ID when it is safe to echo. A generated ID
 * is used for missing, overlong, or control-character-containing values.
 */
export const getRequestId = (request: Request): string => {
  const supplied = request.headers.get("x-request-id")?.trim();
  if (
    supplied &&
    supplied.length <= REQUEST_ID_MAX_LENGTH &&
    /^[\x21-\x7e]+$/.test(supplied)
  ) {
    return supplied;
  }

  return crypto.randomUUID();
};

const responseHeaders = (
  requestId: string,
  extra: Record<string, string> = {},
) => ({
  "x-request-id": requestId,
  ...extra,
});

export const apiSuccess = <T>(
  data: T,
  init: ApiResponseInit,
  meta?: Record<string, unknown>,
) =>
  NextResponse.json(
    meta === undefined
      ? { data, requestId: init.requestId }
      : { data, meta, requestId: init.requestId },
    {
      status: init.status ?? 200,
      headers: responseHeaders(init.requestId, init.headers),
    },
  );

export const apiError = (
  code: ApiErrorCode,
  message: string,
  init: ApiResponseInit,
  details?: unknown,
) =>
  NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId: init.requestId,
      },
      requestId: init.requestId,
    },
    {
      status: init.status ?? 400,
      headers: responseHeaders(init.requestId, init.headers),
    },
  );

export const apiNoContent = (init: ApiResponseInit) =>
  new Response(null, {
    status: init.status ?? 204,
    headers: responseHeaders(init.requestId, init.headers),
  });

export const withApiHeaders = (
  response: Response,
  requestId: string,
  headers: Record<string, string> = {},
) => {
  response.headers.set("x-request-id", requestId);
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
};
