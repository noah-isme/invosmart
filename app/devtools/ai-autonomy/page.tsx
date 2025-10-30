import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AutonomyDashboardClient, { type DashboardState } from "@/app/devtools/ai-autonomy/AutonomyDashboardClient";
import { getLoopState } from "@/lib/ai/loop";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

const serializeState = (state: Awaited<ReturnType<typeof getLoopState>>): DashboardState => {
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    concurrency: state.concurrency,
    history: state.history,
    recentPriorities: state.recentPriorities.map((entry) => ({
      id: entry.id,
      agent: entry.agent,
      weight: entry.weight,
      confidence: entry.confidence,
      rationale: entry.rationale,
      updatedAt: entry.updatedAt.toISOString(),
    })),
    recoveryLog: state.recoveryLog.map((entry) => ({
      id: entry.id,
      agent: entry.agent,
      action: entry.action,
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
      trustScoreBefore: entry.trustScoreBefore ?? null,
      trustScoreAfter: entry.trustScoreAfter ?? null,
      traceId: entry.traceId,
    })),
  } satisfies DashboardState;
};

export default async function AiAutonomyPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const loopState = await getLoopState();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Autonomy Dashboard</h1>
        <p className="text-sm text-text/65">
          Pantau loop otonom InvoSmart, prioritas antar agen, serta tindakan recovery adaptif dengan kontrol manual override.
        </p>
      </header>

      <AutonomyDashboardClient initialState={serializeState(loopState)} />
    </main>
  );
}
