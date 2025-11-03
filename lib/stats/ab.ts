import { z } from "zod";

import { computeEngagementScore, variantPerformanceSchema, type VariantPerformance } from "@/lib/ai/scoring";

const sampleSummarySchema = z.object({
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
});

export type SampleSummary = z.infer<typeof sampleSummarySchema>;

export const calculateRate = (successes: number, total: number) => {
  if (total <= 0) return 0;
  return Math.max(Math.min(successes / total, 1), 0);
};

export const calculateUplift = (control: SampleSummary, variant: SampleSummary) => {
  const controlRate = calculateRate(control.conversions, control.impressions);
  const variantRate = calculateRate(variant.conversions, variant.impressions);

  if (controlRate === 0) {
    return variantRate === 0 ? 0 : variantRate;
  }

  return (variantRate - controlRate) / controlRate;
};

export const estimatePValue = (control: SampleSummary, variant: SampleSummary) => {
  const parsedControl = sampleSummarySchema.parse(control);
  const parsedVariant = sampleSummarySchema.parse(variant);

  const controlRate = calculateRate(parsedControl.conversions, parsedControl.impressions);
  const variantRate = calculateRate(parsedVariant.conversions, parsedVariant.impressions);

  const pooledRate =
    (parsedControl.conversions + parsedVariant.conversions) /
    (parsedControl.impressions + parsedVariant.impressions || 1);

  const standardError = Math.sqrt(
    pooledRate * (1 - pooledRate) * (1 / Math.max(parsedControl.impressions, 1) + 1 / Math.max(parsedVariant.impressions, 1)),
  );

  if (standardError === 0) {
    return 1;
  }

  const zScore = (variantRate - controlRate) / standardError;

  const pValue = 2 * (1 - cumulativeStandardNormal(Math.abs(zScore)));
  return Math.max(Math.min(pValue, 1), 0);
};

const cumulativeStandardNormal = (z: number) => {
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const probability =
    d *
    t *
    (0.3193815 +
      t *
        (-0.3565638 +
          t *
            (1.781478 +
              t *
                (-1.821256 +
                  t * 1.330274))));

  if (z > 0) {
    return 1 - probability;
  }

  return probability;
};

export const minimumSampleSize = ({
  baseRate,
  minDetectableEffect,
  alpha = 0.05,
  beta = 0.2,
}: {
  baseRate: number;
  minDetectableEffect: number;
  alpha?: number;
  beta?: number;
}) => {
  const zAlpha = inverseCumulativeStandardNormal(1 - alpha / 2);
  const zBeta = inverseCumulativeStandardNormal(1 - beta);

  const pooled = baseRate * (1 - baseRate);
  const effect = Math.max(minDetectableEffect, 0.0001);
  const numerator = (zAlpha * Math.sqrt(2 * pooled) + zBeta * Math.sqrt(pooled + effect * (1 - baseRate))) ** 2;

  return Math.ceil(numerator / effect ** 2);
};

const inverseCumulativeStandardNormal = (p: number) => {
  if (p <= 0 || p >= 1) {
    throw new Error("Probability must be between 0 and 1");
  }

  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;

  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;

  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;

  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;

  const plow = 0.02425;
  const phigh = 1 - plow;

  let qValue: number;

  if (p < plow) {
    qValue = Math.sqrt(-2 * Math.log(p));
    return (((((c1 * qValue + c2) * qValue + c3) * qValue + c4) * qValue + c5) * qValue + c6) /
      ((((d1 * qValue + d2) * qValue + d3) * qValue + d4) * qValue + 1);
  }

  if (phigh < p) {
    qValue = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c1 * qValue + c2) * qValue + c3) * qValue + c4) * qValue + c5) * qValue + c6) /
      ((((d1 * qValue + d2) * qValue + d3) * qValue + d4) * qValue + 1);
  }

  const q = p - 0.5;
  const r = q * q;

  return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
};

export const summariseVariantPerformance = (performance: VariantPerformance) => {
  const parsed = variantPerformanceSchema.parse(performance);
  const score = computeEngagementScore(parsed);

  return {
    ...parsed,
    score,
  };
};
