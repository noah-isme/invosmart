/**
 * Mock for next-auth/middleware — used in vitest environment.
 * withAuth is a passthrough wrapper in tests; the real CSRF logic
 * under test lives in handleCsrfAndResponse which doesn't need it.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type MiddlewareFn = (req: NextRequest) => NextResponse | Response | undefined;

export function withAuth(
  middleware: MiddlewareFn,
  _options?: unknown,
): MiddlewareFn {
  return (req: NextRequest) => middleware(req) ?? NextResponse.next();
}
