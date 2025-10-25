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
    const request = args[0] instanceof NextRequest ? (args[0] as NextRequest) : undefined;
    const method = request?.method ?? "UNKNOWN";
    const path = request?.nextUrl?.pathname ?? request?.url ?? "unknown";
    const startedAt = Date.now();

    let status = 500;

    try {
      const response = await handler(...args);
      status = response.status;
      return response;
    } catch (error) {
      Sentry.captureException(error);
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
