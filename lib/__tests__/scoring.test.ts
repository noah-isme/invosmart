import { describe, expect, it } from "vitest";

import { DEFAULT_ENGAGEMENT_WEIGHTS, computeEngagementScore, blendScores } from "@/lib/ai/scoring";

describe("computeEngagementScore", () => {
  it("computes score with normalized dwell", () => {
    const result = computeEngagementScore({ impressions: 1000, clicks: 250, conversions: 80, dwellMs: 120000 });

    expect(result.ctr).toBeCloseTo(0.25, 2);
    expect(result.conversionRate).toBeCloseTo(0.08, 2);
    expect(result.averageDwellMs).toBe(120);
    expect(result.score).toBeGreaterThan(0.1);
  });

  it("handles zero impressions gracefully", () => {
    const result = computeEngagementScore({ impressions: 0, clicks: 0, conversions: 0, dwellMs: 0 });
    expect(result.score).toBe(0);
    expect(result.ctr).toBe(0);
  });
});

describe("blendScores", () => {
  it("averages multiple engagement scores", () => {
    const a = computeEngagementScore({ impressions: 100, clicks: 30, conversions: 10, dwellMs: 40000 });
    const b = computeEngagementScore({ impressions: 200, clicks: 20, conversions: 5, dwellMs: 20000 });

    const blended = blendScores([a, b]);
    expect(blended.ctr).toBeGreaterThan(0);
    expect(blended.weights).toEqual(DEFAULT_ENGAGEMENT_WEIGHTS);
    expect(blended.score).toBeGreaterThan(0);
  });
});
