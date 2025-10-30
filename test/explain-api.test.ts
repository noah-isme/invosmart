import { describe, expect, it, beforeEach, vi } from "vitest";

const mockExplanation = {
  id: "exp_1",
  recommendationId: "rec_1",
  route: "/home",
  why: "Untuk meningkatkan konversi",
  context: "Lalu lintas turun",
  dataBasis: ["Metric A", "Metric B"],
  confidence: 0.82,
  policyStatus: "ALLOWED",
  trustScore: 90,
  createdAt: new Date(),
};

vi.mock("@/middleware/withTiming", () => ({
  withTiming: (handler: unknown) => handler,
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/security", () => ({ enforceHttps: () => null }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => null }));
vi.mock("@/lib/server-telemetry", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/ai/policy", () => ({ isGovernanceEnabled: () => true }));

vi.mock("@/lib/ai/explain", () => ({
  generateExplanationForRecommendation: vi.fn(async () => mockExplanation),
}));

describe("/api/ai/explain", () => {
  beforeEach(async () => {
    const { getServerSession } = await import("next-auth");
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: "user_1", email: "ops@example.com" },
    });
  });

  it("returns explanation payload", async () => {
    const { POST } = await import("@/app/api/ai/explain/route");
    const request = new Request("https://example.com/api/ai/explain", {
      method: "POST",
      body: JSON.stringify({ recommendation_id: "rec_1" }),
    });

    const response = (await POST(request)) as Response;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.why).toBe(mockExplanation.why);
    expect(json.data.policyStatus).toBe("ALLOWED");
  });

  it("validates payload", async () => {
    const { POST } = await import("@/app/api/ai/explain/route");
    const request = new Request("https://example.com/api/ai/explain", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = (await POST(request)) as Response;
    expect(response.status).toBe(400);
  });
});
