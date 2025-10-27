import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";

const handler = NextAuth(authOptions);

// Export the NextAuth handler directly for App Router. Avoid wrapping the
// handler with a NextRequest-based wrapper because the internal NextAuth
// implementation expects the original request/response shape.
export { handler as GET, handler as POST };
