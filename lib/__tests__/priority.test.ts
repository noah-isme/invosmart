import { afterEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    agentPriority: {
      upsert: upsertMock,
      findMany: findManyMock,
    },
  },
}));

describe("priority system", () => {
  afterEach(() => {
    upsertMock.mockReset();
    findManyMock.mockReset();
  });

  it("adjusts weights based on telemetry signal", async () => {
    const { calculatePriorityWeights } = await import("@/lib/ai/priority");
    const result = calculatePriorityWeights({
      load: 0.8,
      successDelta: -0.2,
      trustScore: 50,
      errorRate: 0.12,
    });

    const governance = result.find((entry) => entry.agent === "governance");
    const learning = result.find((entry) => entry.agent === "learning");

    expect(governance?.weight).toBeGreaterThan(learning?.weight ?? 0);
    expect(result).toHaveLength(4);
  });

  it("persists priorities and returns summary", async () => {
    const now = new Date();
    upsertMock.mockResolvedValue({
      id: "1",
      agent: "optimizer",
      weight: 0.4,
      confidence: 0.8,
      rationale: "Optimizer diprioritaskan berdasarkan keberhasilan loop terbaru.",
      updatedAt: now,
    });
    upsertMock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "2",
        agent: "governance",
        weight: 0.3,
        confidence: 0.7,
        rationale: "Governance memastikan kepatuhan saat skor kepercayaan turun.",
        updatedAt: now,
      }),
    );
    upsertMock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "3",
        agent: "learning",
        weight: 0.2,
        confidence: 0.6,
        rationale: "LearningAgent diperkuat untuk mengimbangi area yang belum optimal.",
        updatedAt: now,
      }),
    );
    upsertMock.mockImplementationOnce(() =>
      Promise.resolve({
        id: "4",
        agent: "insight",
        weight: 0.1,
        confidence: 0.55,
        rationale: "InsightAgent membantu mendeteksi pola anomali dan peluang baru.",
        updatedAt: now,
      }),
    );

    const { updateAgentPriorities } = await import("@/lib/ai/priority");
    const response = await updateAgentPriorities({
      load: 0.4,
      successDelta: 0.3,
      trustScore: 72,
      errorRate: 0.05,
    });

    expect(upsertMock).toHaveBeenCalledTimes(4);
    expect(response.summary).toContain("Prioritas agen diperbarui");
  });
});
