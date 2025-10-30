import { dispatchEvent, isOrchestrationEnabled, registerAgent } from "@/lib/ai/orchestrator";

import type { LearningEvaluation } from "@/lib/ai/learning";

if (isOrchestrationEnabled()) {
  registerAgent({
    agentId: "insight",
    name: "InsightAgent",
    description: "Mengolah korelasi performa bulanan dan laporan observabilitas.",
    capabilities: ["trend-detection", "trust-telemetry", "correlation-report"],
  });
}

type InsightReportOptions = {
  evaluations: LearningEvaluation[];
  insight?: string;
  month?: string;
};

const toCorrelationPayload = (evaluation: LearningEvaluation) => ({
  route: evaluation.route,
  compositeImpact: Number(evaluation.compositeImpact.toFixed(4)),
  confidenceShift: Number(evaluation.confidenceShift.toFixed(4)),
  rollbackTriggered: evaluation.rollbackTriggered,
});

export const emitInsightReport = async ({
  evaluations,
  insight,
  month,
}: InsightReportOptions): Promise<void> => {
  if (!isOrchestrationEnabled()) return;
  if (!evaluations.length && !insight) return;

  const correlations = evaluations.map(toCorrelationPayload);
  const summary = insight ??
    `Ringkasan korelasi performa ${month ?? new Date().toISOString().slice(0, 7)}`;

  await dispatchEvent({
    type: "insight_report",
    source: "insight",
    target: "optimizer",
    payload: {
      summary,
      correlations,
      month,
    },
  });
};
