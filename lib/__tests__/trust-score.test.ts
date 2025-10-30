import { describe, expect, it, vi, beforeEach } from "vitest";

import { calculateTrustScore, getTrustMetrics } from "@/lib/ai/trustScore";

vi.mock("@prisma/client", () => ({
  OptimizationStatus: { APPLIED: "APPLIED" },
  PolicyStatus: {
    ALLOWED: "ALLOWED",
    REVIEW: "REVIEW",
    BLOCKED: "BLOCKED",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    optimizationLog: {
      count: vi.fn(),
    },
  },
}));

describe("trust score", () => {
  beforeEach(async () => {
    const { db } = await import("@/lib/db");
    const mockCount = db.optimizationLog.count as unknown as ReturnType<typeof vi.fn>;
    mockCount.mockReset();
  });

  it("weights success, rollback, and policy violations", () => {
    const score = calculateTrustScore({ successRate: 0.9, rollbackRate: 0.1, policyViolationRate: 0.2 });
    const expected = 0.9 * 0.5 + (1 - 0.1) * 0.3 + (1 - 0.2) * 0.2;
    expect(score).toBe(Math.round(expected * 100));
  });

  it("computes metrics from database", async () => {
    const { db } = await import("@/lib/db");
    const mockCount = db.optimizationLog.count as unknown as ReturnType<typeof vi.fn>;
    mockCount.mockResolvedValueOnce(10);
    mockCount.mockResolvedValueOnce(6);
    mockCount.mockResolvedValueOnce(1);
    mockCount.mockResolvedValueOnce(3);

    const metrics = await getTrustMetrics();

    expect(metrics.successRate).toBeCloseTo(0.6);
    expect(metrics.rollbackRate).toBeCloseTo(1 / 6);
    expect(metrics.policyViolationRate).toBeCloseTo(0.3);
  });
});
