import { z } from "zod";

export const variantPerformanceSchema = z.object({
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  dwellMs: z.number().nonnegative(),
});

export type VariantPerformance = z.infer<typeof variantPerformanceSchema>;

export type EngagementWeights = {
  ctr: number;
  conversions: number;
  dwell: number;
};

export const DEFAULT_ENGAGEMENT_WEIGHTS: EngagementWeights = {
  ctr: 0.45,
  conversions: 0.4,
  dwell: 0.15,
};

export type EngagementScore = {
  score: number;
  ctr: number;
  conversionRate: number;
  averageDwellMs: number;
  weights: EngagementWeights;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const computeEngagementScore = (
  performance: VariantPerformance,
  weights: EngagementWeights = DEFAULT_ENGAGEMENT_WEIGHTS,
): EngagementScore => {
  const parsed = variantPerformanceSchema.parse(performance);
  const impressions = Math.max(parsed.impressions, 1);
  const ctr = clamp(parsed.clicks / impressions, 0, 1);
  const conversionRate = clamp(parsed.conversions / impressions, 0, 1);
  const averageDwellMs = parsed.dwellMs / impressions;

  const normalizedDwell = clamp(averageDwellMs / 60000, 0, 1); // normalize to 1 minute
  const score =
    ctr * weights.ctr + conversionRate * weights.conversions + normalizedDwell * weights.dwell;

  return {
    score,
    ctr,
    conversionRate,
    averageDwellMs,
    weights,
  };
};

export const blendScores = (
  scores: EngagementScore[],
  weights?: EngagementWeights,
): EngagementScore => {
  if (!scores.length) {
    return computeEngagementScore({ impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 }, weights);
  }

  const baseWeights = weights ?? scores[0]?.weights ?? DEFAULT_ENGAGEMENT_WEIGHTS;
  const totals = scores.reduce(
    (acc, score) => {
      acc.ctr += score.ctr;
      acc.conversionRate += score.conversionRate;
      acc.averageDwellMs += score.averageDwellMs;
      return acc;
    },
    { ctr: 0, conversionRate: 0, averageDwellMs: 0 },
  );

  const averageCtr = totals.ctr / scores.length;
  const averageConversionRate = totals.conversionRate / scores.length;
  const averageDwellMs = totals.averageDwellMs / scores.length;
  const normalizedDwell = clamp(averageDwellMs / 60000, 0, 1);

  return {
    score:
      averageCtr * baseWeights.ctr +
      averageConversionRate * baseWeights.conversions +
      normalizedDwell * baseWeights.dwell,
    ctr: averageCtr,
    conversionRate: averageConversionRate,
    averageDwellMs,
    weights: baseWeights,
  };
};
