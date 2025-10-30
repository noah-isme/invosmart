import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateAgentPrioritiesMock = vi.fn();
const getTrustScoreMock = vi.fn();
const getOrchestratorSnapshotMock = vi.fn();
const sampleBacklogSizeMock = vi.fn();
const evaluateScalingMock = vi.fn();
const runRecoverySweepMock = vi.fn();
const describeScalingDecisionMock = vi.fn();
const dispatchEventMock = vi.fn();

vi.mock("@/lib/ai/priority", () => ({
  updateAgentPriorities: updateAgentPrioritiesMock,
}));

vi.mock("@/lib/ai/trustScore", () => ({
  getTrustScore: getTrustScoreMock,
}));

vi.mock("@/lib/ai/orchestrator", () => ({
  EVENT_STREAM_KEY: "ai:test",
  getOrchestratorSnapshot: getOrchestratorSnapshotMock,
  isOrchestrationEnabled: () => true,
  dispatchEvent: dispatchEventMock,
}));

vi.mock("@/lib/ai/scaler", () => ({
  sampleBacklogSize: sampleBacklogSizeMock,
  evaluateScaling: evaluateScalingMock,
  describeScalingDecision: describeScalingDecisionMock,
}));

vi.mock("@/lib/ai/recoveryAgent", () => ({
  runRecoverySweep: runRecoverySweepMock,
  listRecoveryLog: vi.fn().mockResolvedValue([]),
}));

describe("autonomous loop", () => {
  beforeEach(() => {
    updateAgentPrioritiesMock.mockReset().mockResolvedValue({
      weights: [
        { id: "1", agent: "optimizer", weight: 0.4, confidence: 0.8, rationale: "", updatedAt: new Date() },
      ],
      summary: "Prioritas agen diperbarui",
    });
    getTrustScoreMock.mockReset().mockResolvedValue({
      score: 70,
      metrics: {
        successRate: 0.75,
        rollbackRate: 0.05,
        policyViolationRate: 0.04,
        totalRecommendations: 40,
        applied: 30,
        violations: 2,
      },
    });
    getOrchestratorSnapshotMock.mockReset().mockResolvedValue({
      agents: [
        { agentId: "optimizer", name: "Optimizer", capabilities: [], priority: 60, streamKey: "x", registeredAt: "" },
      ],
      events: Array.from({ length: 6 }).map((_, index) => ({
        traceId: `trace-${index}`,
        type: "evaluation" as const,
        source: "optimizer" as const,
        priority: 70,
        timestamp: new Date().toISOString(),
        payload: {
          summary: "Evaluasi loop",
          recommendationId: "rec",
          status: "approved" as const,
          compositeImpact: 1,
          rollbackTriggered: false,
          confidence: 0.9,
          notes: "",
        },
      })),
    });
    sampleBacklogSizeMock.mockReset().mockResolvedValue(12);
    evaluateScalingMock.mockReset().mockReturnValue({
      state: { concurrency: 2, intervalMs: 120000 },
      status: "scale_up",
      reason: "Scaling",
      backlogSize: 12,
      avgLatencyMs: 300,
    });
    describeScalingDecisionMock.mockReturnValue("SCALE_UP");
    runRecoverySweepMock.mockReset().mockResolvedValue({
      agent: "optimizer",
      action: "reevaluate",
      reason: "",
      trustScoreBefore: 70,
      trustScoreAfter: 68,
      createdAt: new Date(),
    });
    dispatchEventMock.mockReset();
    process.env.ENABLE_AI_AUTONOMY = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_AI_AUTONOMY;
  });

  it("computes adaptive interval based on telemetry", async () => {
    const { adaptiveInterval } = await import("@/lib/ai/loop");
    const highLoad = adaptiveInterval({ load: 0.9, trustScore: 55, successRate: 0.6, errorRate: 0.12 }, 300000);
    const lowLoad = adaptiveInterval({ load: 0.1, trustScore: 90, successRate: 0.9, errorRate: 0.02 }, 300000);
    expect(highLoad).toBeGreaterThanOrEqual(60000);
    expect(highLoad).toBeLessThanOrEqual(900000);
    expect(highLoad).toBeGreaterThanOrEqual(lowLoad);
  });

  it("runs the loop and returns telemetry", async () => {
    const { runLoop } = await import("@/lib/ai/loop");
    const result = await runLoop({ emitEvent: false });

    expect(result.enabled).toBe(true);
    expect(result.concurrency).toBe(2);
    expect(result.priorities[0].agent).toBe("optimizer");
    expect(updateAgentPrioritiesMock).toHaveBeenCalled();
    expect(runRecoverySweepMock).toHaveBeenCalled();
  });

  it("returns disabled state when autonomy flag is false", async () => {
    delete process.env.ENABLE_AI_AUTONOMY;
    process.env.ENABLE_AI_AUTONOMY = "false";
    const { runLoop } = await import("@/lib/ai/loop");
    const result = await runLoop({ emitEvent: false });
    expect(result.enabled).toBe(false);
  });
});
