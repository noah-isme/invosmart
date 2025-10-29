import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => (props: { data?: unknown }) => <div data-testid="dynamic-chart" data-has-data={Boolean(props.data)} />,
}));

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const notifyMock = vi.fn();

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ notify: notifyMock }),
}));

const triggerLearningCycleActionMock = vi.fn().mockResolvedValue({
  evaluations: [
    {
      route: "/app/dashboard",
      deltaLcp: 0.1,
      deltaInp: 0.05,
      deltaLatency: 0.04,
      deltaErrorRate: 0.02,
      compositeImpact: 0.05,
      rollbackTriggered: false,
      newConfidence: 0.8,
      logsEvaluated: 2,
    },
  ],
  insight: "Improvement detected",
});

vi.mock("@/app/devtools/ai-learning/actions", () => ({
  triggerLearningCycleAction: triggerLearningCycleActionMock,
}));

describe("AI learning dashboard", () => {
  it("renders snapshot data and triggers manual evaluation", async () => {
    const AiLearningClient = (await import("@/app/devtools/ai-learning/AiLearningClient")).default;

    render(
      <AiLearningClient
        profiles={[
          {
            route: "/app/dashboard",
            successRate: 0.6,
            avgImpact: 0.04,
            confidenceWeight: 0.75,
            totalEvaluations: 5,
            lastLcpP95: 3200,
            lastInpP95: 180,
            lastApiLatencyP95: 420,
            lastErrorRate: 0.02,
            lastEval: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
        logs={[
          {
            id: "log-1",
            route: "/app/dashboard",
            change: "Optimize hero",
            impact: "Improve LCP",
            confidence: 0.8,
            status: "APPLIED",
            actor: "system",
            notes: null,
            rollback: false,
            deltaImpact: 0.05,
            evalConfidence: 0.82,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]}
        evaluations={[]}
        insight={null}
      />,
    );

    expect(screen.getByText("Learning curve & impact")).toBeInTheDocument();
    expect(screen.getByText("Snapshot profil")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Re-evaluate sekarang"));

    await waitFor(() => {
      expect(triggerLearningCycleActionMock).toHaveBeenCalled();
      expect(refreshMock).toHaveBeenCalled();
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Evaluasi selesai" }),
      );
    });
  });
});
