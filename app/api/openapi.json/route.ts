import { NextResponse } from "next/server";

import { openApiDocument } from "@/lib/openapi";

export const dynamic = "force-static";

/**
 * Machine-readable OpenAPI contract for the public API.
 *
 * Keeping this endpoint unauthenticated allows SDK generators and external
 * documentation tools to discover the contract without an application
 * session. Resource endpoints still require a workspace API key.
 */
export function GET() {
  return NextResponse.json(openApiDocument, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
