import { NextRequest, NextResponse } from "next/server";

import { runScheduledTick } from "@/lib/ai/loop-scheduler";
import { requireCronAuthorization } from "@/lib/cron-auth";

/**
 * Autonomy loop tick (vercel.json, every 5 minutes). See lib/ai/loop-scheduler.ts
 * and ADR 016. The loop starts paused: until a platform admin resumes it in
 * DevTools every call answers { skipped: "paused" }. `?force=1` runs a tick
 * even when one is not due yet (still subject to paused and the lease).
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handle(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) return authError;

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const result = await runScheduledTick({ now: new Date(), force });
    console.info("[cron/autonomy]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/autonomy] tick failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Autonomy tick failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
