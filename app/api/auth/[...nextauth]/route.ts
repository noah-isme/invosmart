import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";

const handler = NextAuth(authOptions);

const handleWithGuards = (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "auth");
  if (limited) {
    return limited;
  }

  return handler(request);
};

export const GET = (request: NextRequest) => handleWithGuards(request);
export const POST = (request: NextRequest) => handleWithGuards(request);
