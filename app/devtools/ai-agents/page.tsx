import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AgentGraphClient from "@/app/devtools/ai-agents/AgentGraphClient";
import {
  getOrchestratorSnapshot,
  isOrchestrationEnabled,
  listRegisteredAgents,
  resolveConflict,
} from "@/lib/ai/orchestrator";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

const buildConflictSummary = (events: Awaited<ReturnType<typeof getOrchestratorSnapshot>>["events"]) => {
  const grouped = events.reduce<Map<string, typeof events>>((map, event) => {
    const bucket = map.get(event.traceId) ?? [];
    bucket.push(event);
    map.set(event.traceId, bucket);
    return map;
  }, new Map());

  return Array.from(grouped.entries())
    .filter(([, items]) => items.length > 1)
    .map(([traceId, items]) => ({
      traceId,
      winningEvent: resolveConflict(items),
    }));
};

export default async function AiAgentsPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const enabled = isOrchestrationEnabled();
  const snapshot = enabled
    ? await getOrchestratorSnapshot({ limit: 50 })
    : { agents: listRegisteredAgents(), events: [] };

  const conflicts = buildConflictSummary(snapshot.events);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Agent Orchestration</h1>
        <p className="text-sm text-text/65">
          Pantau koordinasi Optimizer, Learning, Governance, dan Insight Agent melalui protokol komunikasi adaptif yang dapat diaudit.
        </p>
      </header>

      <AgentGraphClient enabled={enabled} agents={snapshot.agents} events={snapshot.events} conflicts={conflicts} />
    </main>
  );
}
