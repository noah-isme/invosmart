import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getRevenueInsight } from "@/lib/analytics";
import { rateLimit } from "@/lib/rate-limit";
import { enforceHttps } from "@/lib/security";
import { authOptions } from "@/server/auth";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET(request: NextRequest) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "insight");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const data = await getRevenueInsight(session.user.id);

  return NextResponse.json(data);
}
