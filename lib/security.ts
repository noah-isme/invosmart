import type { NextRequest } from "next/server";

const HTTPS_HEADER = "x-forwarded-proto";
const HTTPS_REQUIRED_RESPONSE = (globalThis as any).NextResponse.json(
  { error: "HTTPS is required for this endpoint" },
  { status: 403 },
);

export const enforceHttps = (request: NextRequest): Response | null => {
  // Only enforce HTTPS in production. During local development the dev server
  // or proxies may set x-forwarded-proto and cause false positives.
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const proto = request.headers.get(HTTPS_HEADER);
  if (proto && proto.toLowerCase() !== "https") {
    return HTTPS_REQUIRED_RESPONSE;
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
