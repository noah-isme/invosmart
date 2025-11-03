import {
  ExperimentAxis,
  ExperimentStatus,
  type ContentExperiment,
  type ContentVariant,
  type Prisma,
  type VariantMetric,
} from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  DEFAULT_ENGAGEMENT_WEIGHTS,
  computeEngagementScore,
  type EngagementScore,
  type VariantPerformance,
  variantPerformanceSchema,
} from "@/lib/ai/scoring";
import { calculateUplift, estimatePValue, summariseVariantPerformance } from "@/lib/stats/ab";

export const variantPayloadSchema = z
  .object({
    hook: z.string().optional(),
    caption: z.string().optional(),
    cta: z.string().optional(),
    schedule: z
      .object({
        day: z.string(),
        hour: z.number().int().min(0).max(23),
        window: z.string().optional(),
        timezone: z.string().optional(),
      })
      .optional(),
    metadata: z.record(z.any()).optional(),
  })
  .passthrough();

export type VariantPayload = z.infer<typeof variantPayloadSchema>;

const serializePayload = (payload: VariantPayload): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;

type VariantRecord = ContentVariant & { metrics: VariantMetric[] };
type ExperimentRecord = ContentExperiment & { variants: VariantRecord[] };

export type VariantWithAnalytics = {
  variant: VariantRecord;
  performance: VariantPerformance;
  engagement: EngagementScore;
  uplift: number;
  pValue: number;
  totalSample: number;
  isWinner: boolean;
};

export type ExperimentSummary = {
  experiment: ExperimentRecord;
  variants: VariantWithAnalytics[];
  baseline?: VariantWithAnalytics;
  winner?: VariantWithAnalytics;
};

export const serializeExperimentSummary = (summary: ExperimentSummary) => ({
  experiment: {
    ...summary.experiment,
    startAt: summary.experiment.startAt?.toISOString?.() ?? summary.experiment.startAt,
    endAt: summary.experiment.endAt?.toISOString?.() ?? summary.experiment.endAt,
    createdAt: summary.experiment.createdAt.toISOString(),
    updatedAt: summary.experiment.updatedAt.toISOString(),
  },
  variants: summary.variants.map((entry) => ({
    id: entry.variant.id,
    variantKey: entry.variant.variantKey,
    payload: entry.variant.payload,
    aiExplanation: entry.variant.aiExplanation,
    confidence: entry.variant.confidence,
    createdAt: entry.variant.createdAt.toISOString(),
    updatedAt: entry.variant.updatedAt.toISOString(),
    performance: entry.performance,
    engagement: entry.engagement,
    uplift: entry.uplift,
    pValue: entry.pValue,
    totalSample: entry.totalSample,
    isWinner: entry.isWinner,
  })),
  baselineVariantId: summary.baseline?.variant.id ?? null,
  winnerVariantId: summary.winner?.variant.id ?? null,
});

const aggregateMetrics = (variant: VariantRecord) => {
  const metrics = variant.metrics ?? [];
  return metrics.reduce(
    (acc, entry) => {
      acc.impressions += entry.impressions;
      acc.clicks += entry.clicks;
      acc.conversions += entry.conversions;
      acc.dwellMs += entry.dwellMs;
      return acc;
    },
    { impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 },
  );
};

const determineVariantKey = (experiment: ExperimentRecord, prefix = "variant") => {
  const existingKeys = new Set(experiment.variants.map((variant) => variant.variantKey));
  if (!existingKeys.has("baseline")) {
    return "baseline";
  }

  for (let index = 1; index < 99; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!existingKeys.has(candidate)) {
      return candidate;
    }
  }

  return `${prefix}-${Date.now()}`;
};

const HOOK_PATTERNS = [
  (seed: string) => `🚀 ${seed}`,
  (seed: string) => `${seed} — Temukan rahasianya sekarang`,
  (seed: string) => `Tanpa ribet: ${seed}`,
  (seed: string) => `Strategi baru untuk ${seed.toLowerCase()}`,
];

const CAPTION_PATTERNS = [
  (seed: string) => `${seed}\n\n➡️ Sorotan utama + langkah konkret`,
  (seed: string) => `Mengapa ini penting sekarang: ${seed}`,
  (seed: string) => `${seed}\n\nDibuktikan oleh data minggu ini.`,
  (seed: string) => `3 takeaways dari ${seed.toLowerCase()} yang tidak boleh dilewatkan.`,
];

const CTA_LIBRARY = [
  "Pelajari Selengkapnya",
  "Coba Sekarang",
  "Mulai Uji Gratis",
  "Lihat Contoh",
  "Optimalkan Kampanye",
];

const SCHEDULE_WINDOWS = [
  { label: "Pagi Produktif", hour: 9 },
  { label: "Siang Santai", hour: 13 },
  { label: "Sore Strategis", hour: 16 },
  { label: "Malam Tenang", hour: 20 },
];

const synthesiseVariantPayload = (
  axis: ExperimentAxis,
  baseline: VariantPayload,
  variantIndex: number,
  options: {
    tone?: "bold" | "curious" | "urgent";
    targetMetric?: "ctr" | "conversions" | "dwell";
    globalSignal?: string;
  } = {},
) => {
  const result = { ...baseline } as VariantPayload;
  const emphasis = options.tone ?? (variantIndex % 2 === 0 ? "bold" : "curious");
  const metric = options.targetMetric ?? "ctr";

  if (axis === "HOOK") {
    const seed = baseline.hook ?? baseline.caption ?? "Konten unggulan";
    const pattern = HOOK_PATTERNS[variantIndex % HOOK_PATTERNS.length];
    result.hook = pattern(seed);
  } else if (axis === "CAPTION") {
    const seed = baseline.caption ?? baseline.hook ?? "Sampaikan nilai utama";
    const pattern = CAPTION_PATTERNS[variantIndex % CAPTION_PATTERNS.length];
    result.caption = pattern(seed);
  } else if (axis === "CTA") {
    const baselineCta = baseline.cta ?? CTA_LIBRARY[0];
    const nextCta = CTA_LIBRARY[(CTA_LIBRARY.indexOf(baselineCta) + variantIndex) % CTA_LIBRARY.length];
    result.cta = nextCta;
  } else if (axis === "SCHEDULE") {
    const window = SCHEDULE_WINDOWS[variantIndex % SCHEDULE_WINDOWS.length];
    const baselineSchedule = baseline.schedule;
    const dayCandidates = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const chosenDay = dayCandidates[(variantIndex + (baselineSchedule ? dayCandidates.indexOf(baselineSchedule.day) : 0)) % dayCandidates.length];
    result.schedule = {
      day: chosenDay,
      hour: window.hour,
      window: window.label,
      timezone: baselineSchedule?.timezone ?? "Asia/Jakarta",
    };
  }

  const emphasisLabel =
    emphasis === "urgent" ? "sense of urgency" : emphasis === "curious" ? "rasa penasaran" : "penekanan nilai";
  const metricLabel = metric === "ctr" ? "CTR" : metric === "conversions" ? "konversi" : "dwell time";

  return {
    payload: result,
    explanation: `Disetel dengan ${emphasisLabel} untuk meningkatkan ${metricLabel}${options.globalSignal ? ` (terinspirasi sinyal global: ${options.globalSignal})` : ""}.`,
  } as const;
};

const mapVariant = (
  variant: VariantRecord,
  baselinePerformance: VariantPerformance,
  winnerId?: number | null,
): VariantWithAnalytics => {
  const performance = aggregateMetrics(variant);
  const engagement = computeEngagementScore(performance, DEFAULT_ENGAGEMENT_WEIGHTS);
  const uplift = calculateUplift(baselinePerformance, performance);
  const pValue = estimatePValue(baselinePerformance, performance);
  const totalSample = performance.impressions;

  return {
    variant,
    performance,
    engagement,
    uplift: Number.isFinite(uplift) ? uplift : 0,
    pValue,
    totalSample,
    isWinner: typeof winnerId === "number" && winnerId === variant.id,
  };
};

const loadExperiment = async (experimentId: number): Promise<ExperimentRecord | null> =>
  db.contentExperiment.findUnique({
    where: { id: experimentId },
    include: { variants: { include: { metrics: true } }, autoActions: true },
  });

export const summariseExperiment = async (experimentId: number): Promise<ExperimentSummary | null> => {
  const experiment = await loadExperiment(experimentId);
  if (!experiment) return null;

  const baselineVariant =
    experiment.variants.find((variant) => variant.variantKey === "baseline") ?? experiment.variants[0];

  const baselinePerformance = baselineVariant ? aggregateMetrics(baselineVariant) : { impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 };
  const variants = experiment.variants.map((variant) =>
    mapVariant(variant, baselinePerformance, experiment.winnerVariantId ?? undefined),
  );

  const baseline = variants.find((entry) => entry.variant.id === baselineVariant?.id);
  const winner = variants.find((entry) => entry.variant.id === experiment.winnerVariantId);

  return {
    experiment,
    variants,
    baseline,
    winner,
  };
};

export const listExperiments = async ({
  organizationId,
  axis,
  status,
  limit = 20,
}: {
  organizationId?: string;
  axis?: ExperimentAxis;
  status?: ExperimentStatus;
  limit?: number;
}) => {
  const experiments = await db.contentExperiment.findMany({
    where: {
      organizationId: organizationId ?? undefined,
      axis,
      status,
    },
    orderBy: { startAt: "desc" },
    take: limit,
    include: { variants: { include: { metrics: true } } },
  });

  return Promise.all(experiments.map((experiment) => summariseExperiment(experiment.id))).then((items) =>
    items.filter((item): item is ExperimentSummary => Boolean(item)),
  );
};

export const startExperiment = async ({
  organizationId,
  contentId,
  axis,
  baseline,
  status = ExperimentStatus.running,
}: {
  organizationId?: string;
  contentId: number;
  axis: ExperimentAxis;
  baseline: VariantPayload;
  status?: ExperimentStatus;
}): Promise<ExperimentSummary> => {
  const experiment = await db.contentExperiment.create({
    data: {
      organizationId,
      contentId,
      axis,
      status,
    },
  });

  const parsedBaseline = variantPayloadSchema.parse(baseline);

  await db.contentVariant.create({
    data: {
      experimentId: experiment.id,
      variantKey: "baseline",
      payload: serializePayload(parsedBaseline),
      aiExplanation: "Baseline konten", // manual baseline
      confidence: 0.7,
    },
  });

  const summary = await summariseExperiment(experiment.id);
  if (!summary) {
    throw new Error("Failed to load experiment after creation");
  }

  return summary;
};

export const generateVariant = async ({
  experimentId,
  tone,
  targetMetric,
  globalSignal,
}: {
  experimentId: number;
  tone?: "bold" | "curious" | "urgent";
  targetMetric?: "ctr" | "conversions" | "dwell";
  globalSignal?: string;
}): Promise<ExperimentSummary> => {
  const experiment = await loadExperiment(experimentId);
  if (!experiment) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  const baselineVariant =
    experiment.variants.find((variant) => variant.variantKey === "baseline") ?? experiment.variants[0];

  const baselinePayload = variantPayloadSchema.parse((baselineVariant?.payload ?? {}) as VariantPayload);

  const { payload, explanation } = synthesiseVariantPayload(
    experiment.axis,
    baselinePayload,
    experiment.variants.length,
    { tone, targetMetric, globalSignal },
  );

  const variantKey = determineVariantKey(experiment);
  const confidence = Math.min(0.9, 0.68 + experiment.variants.length * 0.04);

  await db.contentVariant.create({
    data: {
      experimentId: experiment.id,
      variantKey,
      payload: serializePayload(payload),
      aiExplanation: explanation,
      confidence,
    },
  });

  const summary = await summariseExperiment(experiment.id);
  if (!summary) throw new Error("Failed to summarise experiment after generating variant");
  return summary;
};

export const recordVariantPerformance = async ({
  variantId,
  impressions,
  clicks,
  conversions,
  dwellMs,
}: VariantPerformance & { variantId: number }) => {
  const parsed = variantPerformanceSchema.parse({ impressions, clicks, conversions, dwellMs });
  const existing = await db.variantMetric.findFirst({ where: { variantId } });

  if (!existing) {
    await db.variantMetric.create({
      data: {
        variantId,
        impressions: parsed.impressions,
        clicks: parsed.clicks,
        conversions: parsed.conversions,
        dwellMs: parsed.dwellMs,
        ctr: parsed.impressions ? parsed.clicks / parsed.impressions : 0,
      },
    });
    return summariseVariantPerformance(parsed);
  }

  const updated = await db.variantMetric.update({
    where: { id: existing.id },
    data: {
      impressions: existing.impressions + parsed.impressions,
      clicks: existing.clicks + parsed.clicks,
      conversions: existing.conversions + parsed.conversions,
      dwellMs: existing.dwellMs + parsed.dwellMs,
      ctr:
        existing.impressions + parsed.impressions > 0
          ? (existing.clicks + parsed.clicks) / (existing.impressions + parsed.impressions)
          : 0,
    },
  });

  return summariseVariantPerformance({
    impressions: updated.impressions,
    clicks: updated.clicks,
    conversions: updated.conversions,
    dwellMs: updated.dwellMs,
  });
};

export const chooseWinner = async ({ experimentId, variantId }: { experimentId: number; variantId: number }) => {
  await db.contentExperiment.update({
    where: { id: experimentId },
    data: { winnerVariantId: variantId, status: ExperimentStatus.completed, endAt: new Date() },
  });

  const summary = await summariseExperiment(experimentId);
  if (!summary) throw new Error("Failed to summarise experiment after choosing winner");
  return summary;
};

export const updateExperimentStatus = async ({
  experimentId,
  status,
}: {
  experimentId: number;
  status: ExperimentStatus;
}) => {
  await db.contentExperiment.update({ where: { id: experimentId }, data: { status } });
  const summary = await summariseExperiment(experimentId);
  if (!summary) throw new Error("Failed to summarise experiment after status update");
  return summary;
};
