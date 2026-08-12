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

export const BANDIT_DIM = 8;
export const ALPHA = 0.5;

export interface BanditState {
  A: number[][];
  b: number[];
  sampleCount: number;
}

export function createIdentityMatrix(dim = BANDIT_DIM): number[][] {
  const matrix: number[][] = [];
  for (let i = 0; i < dim; i++) {
    const row = new Array(dim).fill(0);
    row[i] = 1.0;
    matrix.push(row);
  }
  return matrix;
}

export function createZeroVector(dim = BANDIT_DIM): number[] {
  return new Array(dim).fill(0);
}

export function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export function matrixVectorMultiply(matrix: number[][], vector: number[]): number[] {
  const result = new Array(matrix.length).fill(0);
  for (let i = 0; i < matrix.length; i++) {
    let sum = 0;
    for (let j = 0; j < vector.length; j++) {
      sum += matrix[i][j] * vector[j];
    }
    result[i] = sum;
  }
  return result;
}

export function outerProduct(v: number[]): number[][] {
  const dim = v.length;
  const result: number[][] = [];
  for (let i = 0; i < dim; i++) {
    const row: number[] = [];
    for (let j = 0; j < dim; j++) {
      row[j] = v[i] * v[j];
    }
    result.push(row);
  }
  return result;
}

export function matrixAdd(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0].length;
  const result: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      row[j] = A[i][j] + B[i][j];
    }
    result.push(row);
  }
  return result;
}

export function vectorAdd(a: number[], b: number[]): number[] {
  return a.map((val, i) => val + b[i]);
}

export function vectorScale(v: number[], scalar: number): number[] {
  return v.map((val) => val * scalar);
}

export function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => {
    const newRow = new Array(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      newRow[j] = row[j];
    }
    newRow[n + i] = 1.0;
    return newRow;
  });

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(aug[k][k]);
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(aug[i][k]) > maxVal) {
        maxVal = Math.abs(aug[i][k]);
        maxRow = i;
      }
    }

    if (maxVal < 1e-12) {
      return createIdentityMatrix(n);
    }

    if (maxRow !== k) {
      const temp = aug[k];
      aug[k] = aug[maxRow];
      aug[maxRow] = temp;
    }

    const pivot = aug[k][k];
    for (let j = 0; j < 2 * n; j++) {
      aug[k][j] /= pivot;
    }

    for (let i = 0; i < n; i++) {
      if (i !== k) {
        const factor = aug[i][k];
        for (let j = 0; j < 2 * n; j++) {
          aug[i][j] -= factor * aug[k][j];
        }
      }
    }
  }

  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      row[j] = aug[i][n + j];
    }
    inv.push(row);
  }
  return inv;
}

const clamp = (val: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(val) ? val : min));

export function extractFeatureVector({
  impressions = 0,
  clicks = 0,
  conversions = 0,
  dwellMs = 0,
  axis = "HOOK",
  tone = "bold",
  targetMetric = "ctr",
}: {
  impressions?: number;
  clicks?: number;
  conversions?: number;
  dwellMs?: number;
  axis?: ExperimentAxis | string;
  tone?: "bold" | "curious" | "urgent" | string;
  targetMetric?: "ctr" | "conversions" | "dwell" | string;
}): number[] {
  const safeImpressions = Math.max(0, impressions);
  const safeClicks = Math.max(0, clicks);
  const safeConversions = Math.max(0, conversions);
  const safeDwellMs = Math.max(0, dwellMs);

  const denom = Math.max(safeImpressions, 1);

  const x0 = 1.0;
  const x1 = clamp(safeClicks / denom, 0, 1);
  const x2 = clamp(safeConversions / denom, 0, 1);
  const x3 = clamp(safeDwellMs / denom / 60000, 0, 1);
  const x4 = clamp(Math.log10(safeImpressions + 1) / 4.0, 0, 1);

  let x5 = 0.5;
  const axisStr = String(axis);
  if (axisStr === "HOOK") x5 = 1.0;
  else if (axisStr === "CAPTION") x5 = 0.75;
  else if (axisStr === "CTA") x5 = 0.50;
  else if (axisStr === "SCHEDULE") x5 = 0.25;

  let x6 = 0.50;
  if (tone === "bold") x6 = 1.0;
  else if (tone === "curious") x6 = 0.66;
  else if (tone === "urgent") x6 = 0.33;

  let x7 = DEFAULT_ENGAGEMENT_WEIGHTS.ctr;
  if (targetMetric === "ctr") x7 = DEFAULT_ENGAGEMENT_WEIGHTS.ctr;
  else if (targetMetric === "conversions") x7 = DEFAULT_ENGAGEMENT_WEIGHTS.conversions;
  else if (targetMetric === "dwell") x7 = DEFAULT_ENGAGEMENT_WEIGHTS.dwell;

  return [x0, x1, x2, x3, x4, x5, x6, x7];
}

export function createInitialBanditState(): BanditState {
  return {
    A: createIdentityMatrix(BANDIT_DIM),
    b: createZeroVector(BANDIT_DIM),
    sampleCount: 0,
  };
}

export function computeLinUCBScore(
  featureVector: number[],
  state: BanditState = createInitialBanditState(),
  alpha = ALPHA,
): {
  ucbScore: number;
  predictedReward: number;
  uncertainty: number;
  confidence: number;
} {
  const A_inv = invertMatrix(state.A);
  const theta = matrixVectorMultiply(A_inv, state.b);
  const predictedReward = dotProduct(theta, featureVector);

  const A_inv_x = matrixVectorMultiply(A_inv, featureVector);
  const variance = dotProduct(featureVector, A_inv_x);
  const uncertainty = Math.sqrt(Math.max(0, variance));

  const ucbScore = predictedReward + alpha * uncertainty;

  const u2 = uncertainty * uncertainty;
  const rawConfidence = 0.50 + 0.45 * (1.0 - u2 / (1.0 + u2));
  const confidence = clamp(rawConfidence, 0.50, 0.95);

  return { ucbScore, predictedReward, uncertainty, confidence };
}

export const synthesiseVariantPayload = (
  axis: ExperimentAxis,
  baseline: VariantPayload,
  variantIndex: number,
  options: {
    tone?: "bold" | "curious" | "urgent";
    targetMetric?: "ctr" | "conversions" | "dwell";
    globalSignal?: string;
    metrics?: VariantPerformance;
    banditState?: BanditState;
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

  const featureVector = extractFeatureVector({
    impressions: options.metrics?.impressions ?? 0,
    clicks: options.metrics?.clicks ?? 0,
    conversions: options.metrics?.conversions ?? 0,
    dwellMs: options.metrics?.dwellMs ?? 0,
    axis,
    tone: emphasis,
    targetMetric: metric,
  });

  const state = options.banditState ?? createInitialBanditState();
  const { ucbScore, confidence } = computeLinUCBScore(featureVector, state);

  return {
    payload: result,
    explanation: `Disetel dengan ${emphasisLabel} untuk meningkatkan ${metricLabel}${options.globalSignal ? ` (terinspirasi sinyal global: ${options.globalSignal})` : ""}.`,
    confidence,
    ucbScore,
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
  const baselineFeature = extractFeatureVector({
    axis,
    tone: "bold",
    targetMetric: "ctr",
  });
  const baselineBanditState = createInitialBanditState();
  const { confidence: initialConfidence } = computeLinUCBScore(baselineFeature, baselineBanditState);

  const baselinePayloadWithMeta: VariantPayload = {
    ...parsedBaseline,
    metadata: {
      ...(parsedBaseline.metadata || {}),
      banditState: baselineBanditState,
    },
  };

  await db.contentVariant.create({
    data: {
      experimentId: experiment.id,
      variantKey: "baseline",
      payload: serializePayload(baselinePayloadWithMeta),
      aiExplanation: "Baseline konten", // manual baseline
      confidence: initialConfidence,
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

  const { payload, explanation, confidence } = synthesiseVariantPayload(
    experiment.axis,
    baselinePayload,
    experiment.variants.length,
    { tone, targetMetric, globalSignal },
  );

  const banditState = createInitialBanditState();
  const variantKey = determineVariantKey(experiment);

  const payloadWithMeta: VariantPayload = {
    ...payload,
    metadata: {
      ...(payload.metadata || {}),
      tone: tone ?? "bold",
      targetMetric: targetMetric ?? "ctr",
      banditState,
    },
  };

  await db.contentVariant.create({
    data: {
      experimentId: experiment.id,
      variantKey,
      payload: serializePayload(payloadWithMeta),
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
  
  const variantRecord = await db.contentVariant.findUnique({
    where: { id: variantId },
    include: { experiment: true, metrics: true },
  });

  const existing = await db.variantMetric.findFirst({ where: { variantId } });

  let updatedMetric: { impressions: number; clicks: number; conversions: number; dwellMs: number };

  if (!existing) {
    updatedMetric = await db.variantMetric.create({
      data: {
        variantId,
        impressions: parsed.impressions,
        clicks: parsed.clicks,
        conversions: parsed.conversions,
        dwellMs: parsed.dwellMs,
        ctr: parsed.impressions ? parsed.clicks / parsed.impressions : 0,
      },
    });
  } else {
    updatedMetric = await db.variantMetric.update({
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
  }

  const totalPerf = {
    impressions: updatedMetric.impressions,
    clicks: updatedMetric.clicks,
    conversions: updatedMetric.conversions,
    dwellMs: updatedMetric.dwellMs,
  };

  const engagement = computeEngagementScore(totalPerf, DEFAULT_ENGAGEMENT_WEIGHTS);
  const reward = engagement.score;

  if (variantRecord) {
    const rawPayload = (variantRecord.payload ?? {}) as unknown as Record<string, unknown>;
    const metadata =
      rawPayload.metadata &&
      typeof rawPayload.metadata === "object" &&
      !Array.isArray(rawPayload.metadata)
        ? (rawPayload.metadata as Record<string, unknown>)
        : {};

    const candidateState = metadata.banditState;
    const state: BanditState =
      candidateState &&
      typeof candidateState === "object" &&
      "A" in candidateState &&
      Array.isArray(candidateState.A)
        ? (candidateState as BanditState)
        : createInitialBanditState();

    const axis = variantRecord.experiment?.axis ?? "HOOK";
    const tone = typeof metadata.tone === "string" ? metadata.tone : "bold";
    const targetMetric =
      typeof metadata.targetMetric === "string" ? metadata.targetMetric : "ctr";

    const x_a = extractFeatureVector({
      impressions: totalPerf.impressions,
      clicks: totalPerf.clicks,
      conversions: totalPerf.conversions,
      dwellMs: totalPerf.dwellMs,
      axis,
      tone,
      targetMetric,
    });

    const outer = outerProduct(x_a);
    const A_new = matrixAdd(state.A, outer);

    const r_xa = vectorScale(x_a, reward);
    const b_new = vectorAdd(state.b, r_xa);

    const updatedState: BanditState = {
      A: A_new,
      b: b_new,
      sampleCount: (state.sampleCount || 0) + 1,
    };

    const { confidence: newConfidence, ucbScore } = computeLinUCBScore(x_a, updatedState);

    const updatedPayload = {
      ...rawPayload,
      metadata: {
        ...metadata,
        banditState: updatedState,
        ucbScore,
      },
    };

    await db.contentVariant.update({
      where: { id: variantId },
      data: {
        payload: serializePayload(updatedPayload),
        confidence: newConfidence,
      },
    });
  }

  return summariseVariantPerformance(totalPerf);
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
