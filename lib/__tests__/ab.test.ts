import { describe, expect, it } from "vitest";

import { calculateUplift, estimatePValue, minimumSampleSize } from "@/lib/stats/ab";

describe("ab utilities", () => {
  it("calculates uplift", () => {
    const uplift = calculateUplift(
      { impressions: 1000, clicks: 200, conversions: 60 },
      { impressions: 900, clicks: 240, conversions: 72 },
    );
    expect(uplift).toBeGreaterThan(0);
  });

  it("estimates p-value using pooled z-test", () => {
    const pValue = estimatePValue(
      { impressions: 2000, clicks: 300, conversions: 90 },
      { impressions: 2100, clicks: 360, conversions: 120 },
    );
    expect(pValue).toBeGreaterThan(0);
    expect(pValue).toBeLessThan(1);
  });

  it("provides minimum sample size guidance", () => {
    const sampleSize = minimumSampleSize({ baseRate: 0.1, minDetectableEffect: 0.02 });
    expect(sampleSize).toBeGreaterThan(0);
  });
});
