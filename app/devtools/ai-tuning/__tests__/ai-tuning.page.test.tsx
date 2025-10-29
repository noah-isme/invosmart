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

vi.mock("@/lib/ai/optimizer", () => ({
  getLatestRecommendations: vi.fn().mockResolvedValue([
    {
      id: "1",
      route: "/app/dashboard",
      suggestion: "Optimalkan hero",
      impact: "Kurangi LCP",
      confidence: 0.82,
      status: "PENDING",
      actor: "system",
      notes: null,
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    },
    {
      id: "2",
      route: "/app/invoices",
      suggestion: "Prefetch data",
      impact: "Kurangi latency",
      confidence: 0.9,
      status: "PENDING",
      actor: "system",
      notes: null,
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
      status: "APPLIED",
      actor: "system",
      notes: null,
      createdAt: new Date("2024-01-02T00:00:00Z"),
      updatedAt: new Date("2024-01-02T00:00:00Z"),
    },
  ]),
}));

vi.mock("@/app/devtools/ai-tuning/AiTuningClient", () => ({
  default: ({ initialRecommendations }: { initialRecommendations: Array<{ id: string }> }) => (
    <div data-testid="ai-client">{initialRecommendations.length} rekomendasi</div>
  ),
}));

describe("AI tuning page", () => {
  it("renders devtools overview", async () => {
    const ui = await AiTuningPage();
    render(ui);

    expect(screen.getByText(/AI Tuning & Guardrails/i)).toBeInTheDocument();
    expect(screen.getByTestId("ai-client")).toHaveTextContent("2 rekomendasi");
  });
});
