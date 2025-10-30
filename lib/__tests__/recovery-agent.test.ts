import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    recoveryLog: {
      create: createMock,
      findMany: vi.fn(),
    },
  },
}));

const getTrustScoreMock = vi.fn();

vi.mock("@/lib/ai/trustScore", () => ({
  getTrustScore: getTrustScoreMock,
}));

describe("recovery agent", () => {
  afterEach(() => {
    createMock.mockReset();
    getTrustScoreMock.mockReset();
  });

  it("flags rollback when regression exceeds threshold", async () => {
    const { analyzeRecovery } = await import("@/lib/ai/recoveryAgent");
    const action = analyzeRecovery({
      agent: "optimizer",
      trustScoreBefore: 80,
      trustScoreAfter: 60,
      errorRate: 0.2,
    });

    expect(action.action).toBe("rollback");
    expect(action.reason).toContain("Regresi");
  });

  it("persists sweep results using trust metrics", async () => {
    const now = new Date();
    createMock.mockResolvedValue({ id: "rec-1", createdAt: now });
    getTrustScoreMock.mockResolvedValue({
      score: 70,
      metrics: {
        successRate: 0.6,
        rollbackRate: 0.05,
        policyViolationRate: 0.04,
        totalRecommendations: 20,
        applied: 12,
        violations: 1,
      },
    });

    const { runRecoverySweep } = await import("@/lib/ai/recoveryAgent");
    const result = await runRecoverySweep({ errorRate: 0.12 });

    expect(createMock).toHaveBeenCalled();
    expect(result.action === "rollback" || result.action === "reevaluate").toBe(true);
    expect(result.createdAt).toEqual(now);
  });
});
