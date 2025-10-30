import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "user_1" } })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const mockLog = {
  id: "log_1",
  route: "/home",
  change: "Update hero copy",
  impact: "Meningkatkan konversi",
  confidence: 0.8,
  status: "PENDING" as const,
  policyStatus: "ALLOWED" as const,
  policyReason: null,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  explanations: [
    {
      id: "exp_1",
      recommendationId: "log_1",
      route: "/home",
      why: "Traffic menurun",
      context: "Data PostHog 7 hari",
      dataBasis: ["Metric A"],
      confidence: 0.82,
      policyStatus: "ALLOWED" as const,
      trustScore: 92,
      actor: "ops",
      createdAt: new Date("2024-01-02T00:00:00Z"),
      metadata: {},
    },
  ],
};

vi.mock("@/lib/db", () => ({
  db: {
    optimizationLog: {
      findMany: vi.fn(async () => [mockLog]),
    },
  },
}));

vi.mock("@/lib/devtools/access", () => ({ canViewPerfTools: () => true }));

describe("AI audit page", () => {
  it("renders audit entries with explanation", async () => {
    const AiAuditPage = (await import("@/app/devtools/ai-audit/page")).default;
    const ui = await AiAuditPage();
    render(ui);

    expect(await screen.findByText("AI Audit Trail Explorer")).toBeInTheDocument();
    expect(screen.getByText("Update hero copy")).toBeInTheDocument();
    expect(screen.getByText("Traffic menurun")).toBeInTheDocument();
  });
});
