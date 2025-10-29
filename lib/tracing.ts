import * as Sentry from "@sentry/nextjs";

type RouteHandler<TArgs extends unknown[]> = (...args: TArgs) => Promise<Response>;

type SpanOptions = {
  op?: string;
  attributes?: Record<string, unknown>;
  attachTraceIdHeader?: boolean;
};

type SpanLike = {
  setStatus?: (status: string) => void;
  setAttribute?: (key: string, value: unknown) => void;
  spanContext?: () => { traceId?: string } | undefined;
};

const TRACE_HEADER_NAME = "x-trace-id";

const extractRequestAttributes = (args: unknown[]) => {
  if (!args.length) {
    return { method: "UNKNOWN", path: "unknown" } as const;
  }

  const maybeRequest = args[0] as {
    method?: string;
    nextUrl?: { pathname?: string };
    url?: string;
  } | null;

  const method = maybeRequest?.method ?? "UNKNOWN";
  const path = maybeRequest?.nextUrl?.pathname ?? maybeRequest?.url ?? "unknown";

  return { method, path } as const;
};

const attachTraceId = (response: Response, traceId: string | undefined | null) => {
  if (!traceId) return;

  try {
    response.headers.set(TRACE_HEADER_NAME, traceId);
  } catch {
    // silently ignore header mutations for immutable responses
  }
};

export const withSpan = <TArgs extends unknown[]>(
  name: string,
  handler: RouteHandler<TArgs>,
  options?: SpanOptions,
): RouteHandler<TArgs> => {
  const op = options?.op ?? "function.nextjs";

  return async (...args: TArgs) => {
    const sentryAny = Sentry as unknown as {
      startSpan?: <TReturn>(
        context: { name: string; op?: string; attributes?: Record<string, unknown> },
        callback: (span: SpanLike | undefined) => Promise<TReturn> | TReturn,
      ) => Promise<TReturn> | TReturn;
      getActiveSpan?: () => SpanLike | undefined;
    };

    if (typeof sentryAny.startSpan !== "function") {
      return handler(...args);
    }

    const { method, path } = extractRequestAttributes(args);

    const attributes = {
      "http.method": method,
      "http.route": path,
      ...options?.attributes,
    } satisfies Record<string, unknown>;

    return sentryAny.startSpan({ name, op, attributes }, async (span) => {
      try {
        const response = await handler(...args);
        span?.setStatus?.("ok");
        const traceId =
          span?.spanContext?.()?.traceId ?? sentryAny.getActiveSpan?.()?.spanContext?.()?.traceId;

        if (options?.attachTraceIdHeader !== false) {
          attachTraceId(response, traceId);
        }

        return response;
      } catch (error) {
        span?.setStatus?.("internal_error");
        span?.setAttribute?.("invosmart.error", true);
        span?.setAttribute?.("error.message", error instanceof Error ? error.message : "Unknown error");
        throw error;
      }
    });
  };
};

export const __internal = {
  extractRequestAttributes,
  TRACE_HEADER_NAME,
};

