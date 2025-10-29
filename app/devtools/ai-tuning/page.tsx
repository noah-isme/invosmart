import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import AiTuningClient from "@/app/devtools/ai-tuning/AiTuningClient";
import { getLatestRecommendations, getOptimizationHistory } from "@/lib/ai/optimizer";
import { canViewPerfTools } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

export default async function AiTuningPage() {
  const session = await getServerSession(authOptions);

  if (!canViewPerfTools(session)) {
    redirect("/app");
  }

  const [recommendations, history] = await Promise.all([
    getLatestRecommendations({ limit: 20 }),
    getOptimizationHistory({ limit: 50 }),
  ]);

  const actor = session?.user?.email ?? session?.user?.name ?? "admin";

  const serialize = (entry: Awaited<ReturnType<typeof getOptimizationHistory>>[number]) => ({
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-20 pt-12">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">DevTools</p>
        <h1 className="text-3xl font-semibold text-text">AI Tuning &amp; Guardrails</h1>
        <p className="text-sm text-text/65">
          Pantau rekomendasi optimizer, terapkan otomatis, dan catat semua perubahan untuk audit. Hanya tersedia untuk admin
          internal.
        </p>
      </header>

      <AiTuningClient
        initialRecommendations={recommendations.map(serialize)}
        history={history.map(serialize)}
        actor={actor}
      />
    </main>
  );
}
