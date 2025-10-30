import { describe, expect, it } from "vitest";

import { describeScalingDecision, evaluateScaling } from "@/lib/ai/scaler";

describe("scaler controller", () => {
  it("scales up when backlog and latency are high", () => {
    const decision = evaluateScaling(
      {
        avgLatencyMs: 1200,
        backlogSize: 80,
        trustScore: 45,
        successRate: 0.5,
      },
      { concurrency: 1, intervalMs: 300000 },
    );

    expect(decision.status).toBe("scale_up");
    expect(decision.state.concurrency).toBeGreaterThan(1);
    expect(decision.state.intervalMs).toBeLessThan(300000);
  });

  it("scales down when system is idle", () => {
    const decision = evaluateScaling(
      {
        avgLatencyMs: 40,
        backlogSize: 0,
        trustScore: 95,
        successRate: 0.98,
      },
      { concurrency: 3, intervalMs: 120000 },
    );

    expect(decision.status).toBe("scale_down");
    expect(decision.state.concurrency).toBeLessThan(3);
    expect(decision.state.intervalMs).toBeGreaterThan(120000);
  });

  it("produces a descriptive summary", () => {
    const decision = evaluateScaling(
      {
        avgLatencyMs: 400,
        backlogSize: 10,
        trustScore: 80,
        successRate: 0.7,
      },
      { concurrency: 2, intervalMs: 180000 },
    );

    const description = describeScalingDecision(decision);
    expect(description).toContain(decision.status.toUpperCase());
    expect(description).toContain("interval");
  });
});
