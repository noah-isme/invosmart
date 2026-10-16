import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getLoopState, startAutonomyLoop, stopAutonomyLoop } from "@/lib/ai/loop";
import { setAutonomyPaused } from "@/lib/ai/loop-scheduler";
import { isPlatformAdmin } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!isPlatformAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let action: unknown;
  try {
    action = (await request.json())?.action;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // The persisted flag drives the production cron (/api/cron/autonomy);
  // start/stopAutonomyLoop drive the in-process timer used in local dev.
  if (action === "pause") {
    await setAutonomyPaused(true);
    stopAutonomyLoop();
  } else if (action === "resume") {
    await setAutonomyPaused(false);
    await startAutonomyLoop();
  } else {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const state = await getLoopState();
  return NextResponse.json({ state });
}
