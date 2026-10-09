import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getLatestRecommendations } = vi.hoisted(() => ({ getLatestRecommendations: vi.fn() }));
vi.mock("@/lib/ai/optimizer", () => ({ getLatestRecommendations }));

import { GET } from "@/app/api/ai-optimizer/recommendations/route";

describe("GET /api/ai-optimizer/recommendations (anonymous)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ENABLE_AI_OPTIMIZER", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns only route and confidence for each recommendation", async () => {
    getLatestRecommendations.mockResolvedValue([
      {
        id: "rec_1",
        route: "/app/invoices",
        suggestion: "Prefetch data",
        impact: "Kurangi latency",
        confidence: 0.9,
        status: "PENDING",
        actor: "owner@example.com",
        notes: "internal note",
        policyReason: "internal",
        createdAt: new Date(),
      },
    ]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ recommendations: [{ route: "/app/invoices", confidence: 0.9 }] });
  });

  it("returns an empty list when the optimizer is disabled", async () => {
    vi.stubEnv("ENABLE_AI_OPTIMIZER", "false");

    const res = await GET();

    expect(await res.json()).toEqual({ recommendations: [] });
    expect(getLatestRecommendations).not.toHaveBeenCalled();
  });
});
