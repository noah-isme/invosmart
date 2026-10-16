import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const DB_PING_TIMEOUT_MS = 2_000;

/** Resolve when `SELECT 1` succeeds within the timeout; reject otherwise. */
const pingDatabase = async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Database ping timed out")), DB_PING_TIMEOUT_MS);
  });

  try {
    await Promise.race([db.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Shallow liveness by default (no dependencies touched, for load balancers and
 * external monitors). `?db=1` is the deep check the uptime cron probes: it is
 * rate limited and pings the database with a 2 s timeout.
 */
export async function GET(request: NextRequest) {
  if (new URL(request.url).searchParams.get("db") !== "1") {
    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  const limited = rateLimit(request, "health-db");
  if (limited) return limited;

  try {
    await pingDatabase();
    return NextResponse.json(
      { status: "ok", checks: { db: "ok" }, timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    // The error message is logged server-side only; the public response says
    // just which check failed.
    console.error("[health] database check failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { status: "degraded", checks: { db: "error" }, timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
