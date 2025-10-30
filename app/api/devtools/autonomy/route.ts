import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { getLoopState, startAutonomyLoop, stopAutonomyLoop } from "@/lib/ai/loop";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!canViewPerfTools(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let action: unknown;
  try {
    action = (await request.json())?.action;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (action === "pause") {
    stopAutonomyLoop();
  } else if (action === "resume") {
    await startAutonomyLoop();
  } else {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const state = await getLoopState();
  return NextResponse.json({ state });
}
