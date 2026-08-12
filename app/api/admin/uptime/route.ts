import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/server/auth";
import {
  getUptime24hStats,
  getUptimeHistory,
  runUptimeChecks,
} from "@/lib/monitoring/uptime";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;

  try {
    const [history, stats] = await Promise.all([
      getUptimeHistory(limit),
      getUptime24hStats(),
    ]);

    return NextResponse.json({
      history,
      stats,
    });
  } catch (error) {
    console.error("[Admin Uptime GET] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let endpoints: string[] | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.endpoints)) {
        endpoints = body.endpoints;
      } else if (typeof body?.url === "string") {
        endpoints = [body.url];
      }
    } catch {
      // Optional JSON body
    }

    const checkResults = await runUptimeChecks(endpoints);
    const [history, stats] = await Promise.all([
      getUptimeHistory(50),
      getUptime24hStats(),
    ]);

    return NextResponse.json({
      message: "Uptime check executed successfully",
      results: checkResults,
      history,
      stats,
    });
  } catch (error) {
    console.error("[Admin Uptime POST] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
