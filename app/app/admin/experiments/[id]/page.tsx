import { ExperimentAxis } from "@prisma/client";
import { notFound } from "next/navigation";

import { recommendSchedule } from "@/lib/ai/scheduler";
import { serializeExperimentSummary, summariseExperiment } from "@/lib/ai/content-local-optimizer";

import { VariantActionPanel } from "./components/VariantActionPanel";
import { VariantInsightTable } from "./components/VariantInsightTable";

type ExperimentDetailPageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const resolveExperimentId = async (params: ExperimentDetailPageProps["params"]) => {
  const resolved = await params;
  const value = resolved?.id;

  if (!value) {
    return null;
  }

  return Array.isArray(value) ? value[0] ?? null : value;
};

export default async function ExperimentDetailPage({ params }: ExperimentDetailPageProps) {
  const experimentIdParam = await resolveExperimentId(params);
  if (!experimentIdParam) {
    notFound();
  }

  const experimentId = Number.parseInt(experimentIdParam, 10);
  if (Number.isNaN(experimentId)) {
    notFound();
  }

  const summary = await summariseExperiment(experimentId);
  if (!summary) {
    notFound();
  }

  const serialized = serializeExperimentSummary(summary);

  const scheduleRecommendation =
    summary.experiment.axis === ExperimentAxis.SCHEDULE
      ? await recommendSchedule({
          organizationId: summary.experiment.organizationId ?? undefined,
          contentId: summary.experiment.contentId,
        })
      : null;

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-white">Eksperimen #{summary.experiment.id}</h1>
          <p className="text-sm text-white/60">
            Konten #{summary.experiment.contentId} • Axis {summary.experiment.axis} • Status {summary.experiment.status}
          </p>
        </div>
      </section>

      <VariantInsightTable experiment={serialized} />

      <VariantActionPanel
        experimentId={summary.experiment.id}
        contentId={summary.experiment.contentId}
        organizationId={summary.experiment.organizationId ?? undefined}
        variants={serialized.variants}
        winnerVariantId={serialized.winnerVariantId ?? undefined}
        scheduleRecommendation={scheduleRecommendation}
      />
    </div>
  );
}
