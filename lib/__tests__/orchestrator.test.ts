import { beforeEach, describe, expect, it } from "vitest";

const agentEvents: Array<{
  traceId: string;
  eventType: string;
  sourceAgent: string;
  targetAgent: string | null;
  priority: number;
  summary: string;
  payload: unknown;
  recommendationId: string | null;
  createdAt: Date;
}> = [];

vi.mock("@/lib/db", () => ({
  db: {
    agentEventLog: {
      create: vi.fn(async ({ data }: { data: Omit<(typeof agentEvents)[number], "createdAt"> }) => {
        const entry = { ...data, createdAt: new Date() };
        agentEvents.push(entry);
        return entry;
      }),
      findMany: vi.fn(async () => [...agentEvents]),
      findFirst: vi.fn(async ({ where }: { where: { recommendationId?: string; eventType?: string } }) => {
        const matches = agentEvents.filter((event) => {
          if (where.recommendationId && event.recommendationId !== where.recommendationId) return false;
          if (where.eventType && event.eventType !== where.eventType) return false;
          return true;
        });
        return matches.at(-1) ?? null;
      }),
      deleteMany: vi.fn(async () => {
        agentEvents.length = 0;
        return { count: 0 };
      }),
    },
  },
}));

import {
  __dangerousResetOrchestrator,
  dispatchEvent,
  getLatestEvaluationForRecommendation,
  registerAgent,
  resolveConflict,
} from "@/lib/ai/orchestrator";

describe("AI orchestrator", () => {
  beforeEach(async () => {
    process.env.ENABLE_AI_ORCHESTRATION = "true";
    agentEvents.length = 0;
    await __dangerousResetOrchestrator();
  });

  it("registers agent with metadata", () => {
    const registration = registerAgent({
      agentId: "optimizer",
      name: "OptimizerAgent",
      description: "Pengusul perubahan performa",
      capabilities: ["recommendation"],
    });

    expect(registration.priority).toBeGreaterThan(0);
    expect(registration.streamKey).toContain("optimizer");
  });

  it("persists dispatched events and retrieves evaluations", async () => {
    registerAgent({
      agentId: "learning",
      name: "LearningAgent",
    });

    const event = await dispatchEvent({
      type: "evaluation",
      source: "learning",
      target: "governance",
      payload: {
        summary: "Evaluasi lintasan",
        recommendationId: "rec-1",
        status: "approved",
        compositeImpact: 0.24,
        rollbackTriggered: false,
        confidence: 0.82,
      },
    });

    expect(event).not.toBeNull();
    expect(agentEvents.length).toBe(1);

    const latest = await getLatestEvaluationForRecommendation("rec-1");
    expect(latest?.payload.summary).toContain("Evaluasi");
  });

  it("resolves conflict based on governance precedence", () => {
    const learningEvent = {
      traceId: "trace-1",
      type: "evaluation" as const,
      source: "learning" as const,
      target: "governance" as const,
      priority: 60,
      timestamp: new Date().toISOString(),
      payload: {
        summary: "Learning feedback",
        recommendationId: "rec-2",
        status: "needs_review" as const,
        compositeImpact: -0.2,
        rollbackTriggered: false,
        confidence: 0.6,
      },
    };

    const governanceEvent = {
      ...learningEvent,
      source: "governance" as const,
      priority: 90,
      payload: {
        summary: "Governance override",
        recommendationId: "rec-2",
        status: "approved" as const,
        compositeImpact: 0,
        rollbackTriggered: false,
        confidence: 0.9,
      },
    };

    const resolved = resolveConflict([learningEvent, governanceEvent]);
    expect(resolved?.source).toBe("governance");
  });
});
