import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AiLearningClient from "@/app/devtools/ai-learning/AiLearningClient";
import { getLatestExplanationForRecommendation } from "@/lib/ai/explain";
import { getTrustScore } from "@/lib/ai/trustScore";
import { getLearningDashboardData, runLearningCycle } from "@/lib/ai/learning";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

export default async function AiLearningPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const [dashboard, evaluation, trust] = await Promise.all([
    getLearningDashboardData(),
    runLearningCycle(),
    getTrustScore(),
  ]);

  const latestLog = dashboard.logs[0];
  const latestExplanation = latestLog
    ? await getLatestExplanationForRecommendation(latestLog.id)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Continuous Learning</h1>
        <p className="text-sm text-text/65">
          Monitor loop pembelajaran AI optimizer, rollback otomatis, dan insight meta untuk memastikan tuning tetap aman.
        </p>
      </header>

      <AiLearningClient
        profiles={dashboard.profiles}
        logs={dashboard.logs}
        evaluations={evaluation.evaluations}
        insight={evaluation.insight}
        trustScore={trust.score}
        latestExplanation={latestExplanation}
      />
    </main>
  );
}
