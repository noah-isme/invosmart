import { NextRequest, NextResponse } from "next/server";

const HTTPS_HEADER = "x-forwarded-proto";

export const enforceHttps = (request: NextRequest): Response | null => {
  // Only enforce HTTPS in production. During local development the dev server
  // or proxies may set x-forwarded-proto and cause false positives.
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  // Do not enforce HTTPS for localhost or 127.0.0.1 (e.g. during local E2E tests)
  const url = new URL(request.url);
  const hostname = url.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  const proto = request.headers.get(HTTPS_HEADER);
  if (proto && proto.toLowerCase() !== "https") {
    return NextResponse.json(
      { error: "HTTPS is required for this endpoint" },
      { status: 403 },
    );
  }

  return null;
};

export const getClientIp = (request: NextRequest): string => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
};
