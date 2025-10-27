import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { captureServerMetric } from "@/lib/server-telemetry";

type RouteHandler<TArgs extends unknown[]> = (...args: TArgs) => Promise<Response>;

type TimingOptions = {
  metricName?: string;
};

export const withTiming = <TArgs extends unknown[]>(
  handler: RouteHandler<TArgs>,
  options?: TimingOptions,
) =>
  async (...args: TArgs) => {
    // can't rely on instanceof checks in runtime across environments; use duck-typing
    const maybeRequest = args[0] as unknown as { method?: string; nextUrl?: { pathname?: string }; url?: string } | undefined;
    const method = maybeRequest?.method ?? "UNKNOWN";
    const path = maybeRequest?.nextUrl?.pathname ?? maybeRequest?.url ?? "unknown";
    const startedAt = Date.now();

    let status = 500;

    try {
      const response = await handler(...args);
      status = response.status;
      return response;
    } catch (error) {
      (Sentry as any).captureException?.(error);
      throw error;
    } finally {
      const duration = Date.now() - startedAt;
      console.log(`[API] ${method} ${path} took ${duration}ms`);
      void captureServerMetric(options?.metricName ?? "api_latency", duration, {
        path,
        method,
        status,
      });
    }
  };
