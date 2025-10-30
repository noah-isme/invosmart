import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AiTuningPage from "@/app/devtools/ai-tuning/page";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { email: "admin@example.com" } }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/devtools/access", () => ({
  canViewPerfTools: () => true,
}));

vi.mock("@/lib/ai/optimizer", () => {
  const base = {
    actor: "system",
    notes: null,
    rollback: false,
    deltaImpact: 0,
    evalConfidence: 0.8,
    policyStatus: "ALLOWED" as const,
    policyReason: null,
  };

  return {
    getLatestRecommendations: vi.fn().mockResolvedValue([
      {
        id: "1",
        route: "/app/dashboard",
        suggestion: "Optimalkan hero",
        impact: "Kurangi LCP",
        confidence: 0.82,
        status: "PENDING" as const,
        ...base,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      },
      {
        id: "2",
        route: "/app/invoices",
        suggestion: "Prefetch data",
        impact: "Kurangi latency",
        confidence: 0.9,
        status: "PENDING" as const,
        ...base,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-01T00:00:00Z"),
      },
    ]),
    getOptimizationHistory: vi.fn().mockResolvedValue([
      {
        id: "3",
        route: "/app/dashboard",
        suggestion: "Optimalkan hero",
        impact: "Kurangi LCP",
        confidence: 0.82,
        status: "APPLIED" as const,
        ...base,
        createdAt: new Date("2024-01-02T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ]),
  };
});

vi.mock("@/lib/ai/explain", () => ({
  getLatestExplanationsMap: vi.fn().mockResolvedValue(
    new Map([
      [
        "1",
        {
          id: "exp1",
          recommendationId: "1",
          route: "/app/dashboard",
          why: "Confidence tinggi",
          context: "Audit manual",
          dataBasis: ["Metric"],
          confidence: 0.8,
          policyStatus: "ALLOWED",
          trustScore: 90,
          createdAt: new Date("2024-01-03T00:00:00Z"),
        },
      ],
    ]),
  ),
}));

vi.mock("@/lib/ai/trustScore", () => ({
  getTrustScore: vi.fn().mockResolvedValue({
    score: 92,
    metrics: {
      successRate: 0.8,
      rollbackRate: 0.1,
      policyViolationRate: 0.05,
      totalRecommendations: 10,
      applied: 8,
      violations: 1,
    },
  }),
}));

vi.mock("@/app/devtools/ai-tuning/AiTuningClient", () => ({
  default: ({ initialRecommendations, trustScore }: { initialRecommendations: Array<{ id: string }>; trustScore: number }) => (
    <div data-testid="ai-client">{initialRecommendations.length} rekomendasi · trust {trustScore}</div>
  ),
}));

describe("AI tuning page", () => {
  it("renders devtools overview", async () => {
    const ui = await AiTuningPage();
    render(ui);

    expect(screen.getByText(/AI Tuning & Guardrails/i)).toBeInTheDocument();
    expect(screen.getByTestId("ai-client")).toHaveTextContent("2 rekomendasi · trust 92");
  });
});
