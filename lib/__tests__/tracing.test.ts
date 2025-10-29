import { beforeEach, describe, expect, it, vi } from "vitest";

import { __internal, withSpan } from "@/lib/tracing";
import * as Sentry from "@sentry/nextjs";

const { TRACE_HEADER_NAME } = __internal;

describe("withSpan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches trace header and sets span status", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withSpan("test-span", handler);

    const response = await wrapped({ method: "GET", nextUrl: { pathname: "/api/test" } } as unknown as Request);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(response.headers.get(TRACE_HEADER_NAME)).toBe("mock-trace-id");
    expect(Sentry.startSpan).toHaveBeenCalled();
  });

  it("respects attachTraceIdHeader option", async () => {
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withSpan("skip-trace", handler, { attachTraceIdHeader: false });

    const response = await wrapped({ method: "POST", nextUrl: { pathname: "/api/test" } } as unknown as Request);

    expect(response.headers.get(TRACE_HEADER_NAME)).toBeNull();
  });
});

