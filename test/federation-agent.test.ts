import { beforeEach, describe, expect, it, vi } from "vitest";

import { FederationAgent } from "@/lib/ai/federationAgent";
import { FederationBus, type FederationInboundStore } from "@/lib/federation/bus";
import type { FederationEvent } from "@/lib/federation/protocol";
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
    bus = new FederationBus({ tenantId: "tenant-a", secret: "secret", hmacSecret: "secret-hmac", enabled: true });
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

  it("operates with asymmetrically signed FederationBus", async () => {
    const keys = (await import("@/lib/federation/bus")).generateFederationKeyPair();
    const asymBus = new FederationBus({
      tenantId: "tenant-a",
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      enabled: true,
    });

    const persistMetrics = vi.fn().mockResolvedValue({
      ...buildInsight(),
      averageLatencyMs: 100,
      highestTenant: { tenantId: "tenant-a", trustScore: 85 },
      lowestTenant: { tenantId: "tenant-a", trustScore: 85 },
    });

    const agent = new FederationAgent({
      bus: asymBus,
      dependencies: {
        fetchTrustScore: async () => ({
          score: 85,
          metrics: {
            successRate: 0.9,
            rollbackRate: 0.05,
            policyViolationRate: 0.01,
            totalRecommendations: 20,
            applied: 18,
            violations: 0,
          },
        }),
        fetchPriorities: async () => [
          { agent: "optimizer", weight: 0.5, confidence: 0.9, rationale: "Opt" },
        ],
        persistMetrics,
      },
    });

    const result = await agent.broadcastLocalSnapshot();
    expect(result?.event?.signatureAlgorithm).toBe("rsa-sha256");
    expect(persistMetrics).toHaveBeenCalledTimes(1);
  });
});

// Replay log stand-in with the unique signatureHash constraint.
const memoryInboundStore = (): FederationInboundStore => {
  const seen = new Set<string>();
  return {
    create: vi.fn(async ({ data }) => {
      if (seen.has(data.signatureHash)) {
        throw Object.assign(new Error("Unique constraint failed on signatureHash"), { code: "P2002" });
      }
      seen.add(data.signatureHash);
      return data;
    }),
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("FederationAgent between two wired peers", () => {
  const priorities = [{ agent: "optimizer" as const, weight: 0.5, confidence: 0.5, rationale: "x" }];
  const persistedInsight = () => ({
    ...buildInsight(),
    averageTrust: 50,
    highestTenant: null,
    lowestTenant: null,
    averageLatencyMs: 0,
  });

  /**
   * Two buses whose fetch delivers straight into the other bus's ingest(), the
   * way /api/federation/events does (and answers 202). The cap stops a
   * regression from spinning forever; the assertions are far below it.
   */
  const wirePeers = (fetchPriorities: () => Promise<typeof priorities>) => {
    const buses: Record<"A" | "B", FederationBus> = {} as Record<"A" | "B", FederationBus>;
    const delivered: Array<{ to: string; type: string }> = [];
    const ingestErrors: string[] = [];
    const route = (to: "A" | "B") =>
      (async (_url: string, init?: RequestInit) => {
        if (delivered.length >= 200) return new Response("{}", { status: 429 });
        const event = JSON.parse(String(init?.body)) as FederationEvent;
        delivered.push({ to, type: event.type });
        try {
          await buses[to].ingest(event);
        } catch (error) {
          ingestErrors.push(error instanceof Error ? error.message : String(error));
        }
        return new Response("{}", { status: 202 });
      }) as unknown as typeof fetch;

    const options = { hmacSecret: "shared-hmac", enabled: true };
    buses.A = new FederationBus({ ...options, tenantId: "A", endpoints: ["https://b.example"], fetchImpl: route("B"), inboundStore: memoryInboundStore() });
    buses.B = new FederationBus({ ...options, tenantId: "B", endpoints: ["https://a.example"], fetchImpl: route("A"), inboundStore: memoryInboundStore() });

    const persist = { A: vi.fn().mockResolvedValue(persistedInsight()), B: vi.fn().mockResolvedValue(persistedInsight()) };
    const agents = (["A", "B"] as const).map(
      (tenant) =>
        new FederationAgent({
          bus: buses[tenant],
          tenantId: tenant,
          dependencies: {
            fetchTrustScore: async () => ({ score: 50, metrics: undefined }),
            fetchPriorities,
            persistMetrics: persist[tenant],
          },
        }),
    );
    return { buses, delivered, ingestErrors, persist, agents };
  };

  it("answers a peer's telemetry once and never republishes priority_share or model_update", async () => {
    const { buses, delivered, ingestErrors, persist, agents } = wirePeers(async () => priorities);

    await buses.A.publish({
      type: "telemetry_sync",
      payload: { tenantId: "A", trustScore: 50, priorities, sanitized: true },
    });
    await flush();

    // A -> B telemetry_sync; B evaluates once and sends its three cycle events back to A.
    expect(delivered).toEqual([
      { to: "B", type: "telemetry_sync" },
      { to: "A", type: "trust_aggregate" },
      { to: "A", type: "priority_share" },
      { to: "A", type: "model_update" },
    ]);
    expect(ingestErrors).toEqual([]);
    expect(persist.B).toHaveBeenCalledTimes(1);
    expect(persist.A).not.toHaveBeenCalled();
    // A received B's model_update (the signature verified) and recorded it.
    expect(agents[0].getModelHistory()).toEqual([expect.objectContaining({ tenantId: "B", notes: "Sinkronisasi global (telemetry)" })]);

    for (const agent of agents) agent.dispose();
  });

  it("stays bounded when both peers broadcast their snapshots", async () => {
    const { delivered, ingestErrors, agents } = wirePeers(async () => priorities);

    await agents[0].broadcastLocalSnapshot();
    await agents[1].broadcastLocalSnapshot();
    await flush();

    // Each broadcast: 1 telemetry_sync + 3 own cycle events to the peer, and the
    // peer's 3 cycle events in answer to the telemetry.
    expect(delivered).toHaveLength(14);
    expect(ingestErrors).toEqual([]);

    for (const agent of agents) agent.dispose();
  });

  it("publishes only trust_aggregate when no tenant reports priorities, without unhandled rejections", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const { buses, delivered, ingestErrors, persist, agents } = wirePeers(async () => []);

      await buses.A.publish({
        type: "telemetry_sync",
        payload: { tenantId: "A", trustScore: 50, priorities: [], sanitized: true },
      });
      await flush();

      expect(persist.B).toHaveBeenCalledTimes(1);
      expect(delivered).toEqual([
        { to: "B", type: "telemetry_sync" },
        { to: "A", type: "trust_aggregate" },
      ]);
      expect(ingestErrors).toEqual([]);
      expect(rejections).toEqual([]);

      for (const agent of agents) agent.dispose();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

