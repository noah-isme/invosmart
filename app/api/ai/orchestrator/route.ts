import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import {
  getOrchestratorSnapshot,
  isOrchestrationEnabled,
  resolveConflict,
} from "@/lib/ai/orchestrator";
import { canViewPerfTools } from "@/lib/devtools/access";
import { withSpan } from "@/lib/tracing";
import { authOptions } from "@/server/auth";

const orchestratorStatus = async (request: NextRequest) => {
  if (!isOrchestrationEnabled()) {
    return NextResponse.json({
      enabled: false,
      agents: [],
      events: [],
      conflicts: [],
    });
  }

  const session = await getServerSession(authOptions);
  if (!canViewPerfTools(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limitParam =
    request.nextUrl?.searchParams?.get("limit") ??
    new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(100, Math.max(5, Number.parseInt(limitParam, 10) || 25)) : 25;
  const snapshot = await getOrchestratorSnapshot({ limit });

  const conflicts = snapshot.events.reduce<Map<string, typeof snapshot.events>>((map, event) => {
    const events = map.get(event.traceId) ?? [];
    events.push(event);
    map.set(event.traceId, events);
    return map;
  }, new Map());

  const conflictResolutions = Array.from(conflicts.entries())
    .filter(([, events]) => events.length > 1)
    .map(([traceId, events]) => ({
      traceId,
      winningEvent: resolveConflict(events),
    }));

  return NextResponse.json(
    {
      enabled: true,
      agents: snapshot.agents,
      events: snapshot.events,
      conflicts: conflictResolutions,
      lastUpdated: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};

export const GET = withSpan("api.ai.orchestrator.status", orchestratorStatus, {
  op: "http.server",
  attributes: { "api.operation": "ai_orchestrator_status" },
});
