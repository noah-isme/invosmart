import { NextRequest, NextResponse } from "next/server";
import { runUptimeChecks } from "@/lib/monitoring/uptime";

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      const urlSecret = new URL(request.url).searchParams.get("secret");
      if (authHeader !== `Bearer ${cronSecret}` && urlSecret !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const endpointsParam = searchParams.get("endpoints") || searchParams.get("urls");
    const endpoints = endpointsParam
      ? endpointsParam.split(",").map((e) => e.trim()).filter(Boolean)
      : undefined;

    const results = await runUptimeChecks(endpoints);
    const downCount = results.filter((r) => r.status === "DOWN" || r.statusCode !== 200).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        up: results.length - downCount,
        down: downCount,
      },
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron Uptime GET] Error:", message);
    return NextResponse.json(
      {
        success: false,
        error: message || "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = request.headers.get("authorization");
      const urlSecret = new URL(request.url).searchParams.get("secret");
      if (authHeader !== `Bearer ${cronSecret}` && urlSecret !== cronSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    let endpoints: string[] | undefined;
    try {
      const body = await request.json();
      if (Array.isArray(body?.endpoints)) {
        endpoints = body.endpoints;
      } else if (Array.isArray(body?.urls)) {
        endpoints = body.urls;
      } else if (typeof body?.url === "string") {
        endpoints = [body.url];
      }
    } catch {
      // Body is optional
    }

    const results = await runUptimeChecks(endpoints);
    const downCount = results.filter((r) => r.status === "DOWN" || r.statusCode !== 200).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        up: results.length - downCount,
        down: downCount,
      },
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron Uptime POST] Error:", message);
    return NextResponse.json(
      {
        success: false,
        error: message || "Internal server error",
      },
      { status: 500 }
    );
  }
}
