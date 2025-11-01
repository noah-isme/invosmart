import { beforeEach, describe, expect, it, vi } from "vitest";

import { FederationAgent } from "@/lib/ai/federationAgent";
import { FederationBus } from "@/lib/federation/bus";
import type { GlobalFederationInsight } from "@/lib/ai/globalInsight";

vi.mock("@/lib/ai/orchestrator", () => ({
  registerAgent: vi.fn(),
  isOrchestrationEnabled: () => true,
  dispatchEvent: vi.fn(() => Promise.resolve()),
}));

const buildInsight = (): GlobalFederationInsight => ({
  averageTrust: 82,
  medianTrust: 80,
  trustStdDeviation: 6,
  participants: 1,
  aggregatedPriorities: [
    { agent: "optimizer", weight: 0.4, confidence: 0.82, rationale: "Optimizer" },
    { agent: "federation", weight: 0.1, confidence: 0.76, rationale: "Federation" },
  ],
  networkHealth: "healthy",
  summary: "Jaringan stabil",
});

describe("FederationAgent", () => {
  let bus: FederationBus;

  beforeEach(() => {
    bus = new FederationBus({ tenantId: "tenant-a", secret: "secret", enabled: true });
  });

  it("broadcasts local snapshot and records metrics", async () => {
    const persistMetrics = vi.fn().mockResolvedValue({
      ...buildInsight(),
      averageLatencyMs: 120,
      highestTenant: { tenantId: "tenant-a", trustScore: 82 },
      lowestTenant: { tenantId: "tenant-a", trustScore: 82 },
    });

    const agent = new FederationAgent({
      bus,
      dependencies: {
        fetchTrustScore: async () => ({
          score: 82,
          metrics: {
            successRate: 0.8,
            rollbackRate: 0.1,
            policyViolationRate: 0.05,
            totalRecommendations: 15,
            applied: 12,
            violations: 1,
          },
        }),
        fetchPriorities: async () => [
          { agent: "optimizer", weight: 0.42, confidence: 0.8, rationale: "Optimizer naik" },
          { agent: "federation", weight: 0.08, confidence: 0.72, rationale: "Sinkron" },
        ],
        persistMetrics,
      },
    });

    const result = await agent.broadcastLocalSnapshot();

    expect(result?.event?.type).toBe("telemetry_sync");
    expect(persistMetrics).toHaveBeenCalledTimes(1);
    const trustAggregate = bus.getRecentEvents().find((event) => event.type === "trust_aggregate");
    expect(trustAggregate).toBeTruthy();
    expect(agent.getSnapshots().length).toBeGreaterThan(0);
  });

  it("ingests remote telemetry and computes global insight", async () => {
    const persistMetrics = vi.fn().mockResolvedValue({
      ...buildInsight(),
      participants: 2,
      averageLatencyMs: 98,
      highestTenant: { tenantId: "tenant-b", trustScore: 90 },
      lowestTenant: { tenantId: "tenant-a", trustScore: 82 },
    });

    const agent = new FederationAgent({
      bus,
      dependencies: {
        fetchTrustScore: async () => ({
          score: 82,
          metrics: {
            successRate: 0.78,
            rollbackRate: 0.12,
            policyViolationRate: 0.04,
            totalRecommendations: 14,
            applied: 11,
            violations: 1,
          },
        }),
        fetchPriorities: async () => [
          { agent: "optimizer", weight: 0.4, confidence: 0.78, rationale: "Stabil" },
          { agent: "federation", weight: 0.1, confidence: 0.74, rationale: "Sinkron" },
        ],
        persistMetrics,
      },
    });

    await agent.broadcastLocalSnapshot();

    await bus.publish({
      type: "telemetry_sync",
      tenantId: "tenant-b",
      payload: {
        tenantId: "tenant-b",
        trustScore: 90,
        priorities: [
          { agent: "optimizer", weight: 0.38, confidence: 0.82, rationale: "High" },
          { agent: "federation", weight: 0.12, confidence: 0.8, rationale: "Shared" },
        ],
        sanitized: true,
      },
    });

    expect(persistMetrics).toHaveBeenCalledTimes(2);
    expect(agent.getSnapshots().length).toBeGreaterThanOrEqual(2);
    expect(agent.getTrustHistory().length).toBeGreaterThan(0);
    expect(agent.getModelHistory().length).toBeGreaterThan(0);
  });
});
