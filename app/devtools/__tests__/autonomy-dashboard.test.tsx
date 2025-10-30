import type { ReactNode } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AutonomyDashboardClient, { type DashboardState } from "@/app/devtools/ai-autonomy/AutonomyDashboardClient";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="chart">{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe("AutonomyDashboardClient", () => {
  const baseState: DashboardState = {
    enabled: false,
    intervalMs: 120000,
    concurrency: 1,
    history: [
      { timestamp: "2024-01-01T00:00:00Z", load: 0.4, backlogSize: 4, trustScore: 70, successRate: 0.6, errorRate: 0.05, avgLatencyMs: 300 },
      { timestamp: "2024-01-01T00:02:00Z", load: 0.2, backlogSize: 1, trustScore: 80, successRate: 0.7, errorRate: 0.04, avgLatencyMs: 200 },
    ],
    recentPriorities: [
      { id: "1", agent: "optimizer", weight: 0.4, confidence: 0.8, rationale: "", updatedAt: "2024-01-01T00:00:00Z" },
    ],
    recoveryLog: [
      { id: "rec-1", agent: "optimizer", action: "reevaluate", reason: "trust drop", createdAt: "2024-01-01T00:00:00Z" },
    ],
  };

  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders telemetry chart and priority cards", () => {
    render(<AutonomyDashboardClient initialState={baseState} />);
    expect(screen.getByText(/Autonomy Loop Status/)).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getAllByText(/optimizer/i).length).toBeGreaterThan(0);
  });

  it("sends resume command and updates local state", async () => {
    const resumedState: DashboardState = {
      ...baseState,
      enabled: true,
      concurrency: 2,
      intervalMs: 60000,
    };

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ state: resumedState }),
    });

    render(<AutonomyDashboardClient initialState={baseState} />);

    fireEvent.click(screen.getByText(/Resume/));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/devtools/autonomy",
      expect.objectContaining({
        method: "POST",
      }),
    ));

    await waitFor(() => expect(screen.getByText(/Active/)).toBeInTheDocument());
    expect(screen.getByText(/Interval adaptif/)).toHaveTextContent(/Concurrency:\s*2/);
  });
});
