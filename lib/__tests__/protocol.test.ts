import { describe, expect, it } from "vitest";

import {
  agentPriority,
  createEventTimestamp,
  ensurePriority,
  mapEventSchema,
  sortEventsByGovernance,
  type AgentRole,
  type MapEvent,
} from "@/lib/ai/protocol";

describe("MAP protocol", () => {
  it("validates recommendation payload", () => {
    const event = mapEventSchema.parse({
      traceId: "trace-1",
      type: "recommendation",
      source: "optimizer",
      target: "governance",
      priority: agentPriority.optimizer,
      timestamp: createEventTimestamp(),
      payload: {
        summary: "Optimasi /app/invoices",
        recommendationId: "rec-1",
        route: "/app/invoices",
        confidence: 0.8,
        impact: "Kurangi blocking asset",
      },
    });

    expect(event.payload.route).toBe("/app/invoices");
  });

  it("rejects event tanpa summary", () => {
    expect(() =>
      mapEventSchema.parse({
        traceId: "trace-2",
        type: "evaluation",
        source: "learning",
        target: "governance",
        priority: agentPriority.learning,
        timestamp: createEventTimestamp(),
        payload: {
          // @ts-expect-error intentionally missing summary
          recommendationId: "rec-2",
          status: "approved",
          compositeImpact: 0.12,
          rollbackTriggered: false,
          confidence: 0.78,
        },
      }),
    ).toThrow();
  });

  it("sorts events by governance priority first", () => {
    const buildEvent = (source: AgentRole, priority: number): MapEvent => ({
      traceId: `trace-${source}`,
      type: "evaluation",
      source,
      target: "governance",
      priority,
      timestamp: createEventTimestamp(),
      payload: {
        summary: `${source} update`,
        recommendationId: `rec-${source}`,
        status: "approved",
        compositeImpact: 0.1,
        rollbackTriggered: false,
        confidence: 0.9,
      },
    });

    const sorted = sortEventsByGovernance([
      buildEvent("learning", 60),
      buildEvent("optimizer", 75),
      buildEvent("governance", 90),
    ]);

    expect(sorted[0]?.source).toBe("governance");
    expect(sorted.at(-1)?.source).toBe("learning");
  });

  it("allows priority override within range", () => {
    const value = ensurePriority("insight", 110);
    expect(value).toBe(100);
  });
});
