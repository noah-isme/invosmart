import type { ReactNode } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import AiFederationClient, {
  type FederationDashboardState,
} from "@/app/devtools/ai-federation/AiFederationClient";

vi.mock("reactflow", () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div data-testid="reactflow">{children}</div>,
  Background: () => <div data-testid="background" />,
  Controls: () => <div />,
  MiniMap: () => <div />,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="chart">{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  AreaChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Area: () => <div />,
}));

describe("AiFederationClient", () => {
  const baseState: FederationDashboardState = {
    enabled: true,
    tenantId: "tenant-a",
    endpoints: ["https://tenant-b.com"],
    connections: [{ endpoint: "https://tenant-b.com", healthy: true }],
    recentEvents: [
      {
        id: "evt-1",
        type: "telemetry_sync",
        tenantId: "tenant-a",
        timestamp: new Date().toISOString(),
        signature: "sig",
        payload: {
          tenantId: "tenant-a",
          trustScore: 82,
          priorities: [],
          sanitized: true,
        },
      },
    ],
    snapshots: [
      {
        tenantId: "tenant-a",
        trustScore: 82,
        syncLatencyMs: 120,
        priorities: [
          { agent: "optimizer", weight: 0.4, confidence: 0.82, rationale: "Stabil" },
          { agent: "federation", weight: 0.1, confidence: 0.75, rationale: "Sinkron" },
        ],
        updatedAt: new Date().toISOString(),
      },
    ],
    trustHistory: [
      {
        tenantId: "tenant-a",
        cycleId: "cycle-1",
        participants: 1,
        averageTrust: 82,
        highestTrust: null,
        lowestTrust: null,
        networkHealth: "healthy",
        aggregatedPriorities: [],
        summary: "Stable",
        receivedAt: new Date().toISOString(),
      },
    ],
    modelHistory: [
      {
        tenantId: "tenant-a",
        cycleId: "cycle-1",
        priorities: [],
        trustScore: 82,
        appliedAt: new Date().toISOString(),
        notes: "",
        receivedAt: new Date().toISOString(),
      },
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

  it("renders network map and trust charts", () => {
    render(<AiFederationClient initialState={baseState} />);

    expect(screen.getByText(/Peta Jaringan Federasi/)).toBeInTheDocument();
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
    expect(screen.getByText(/Rangkaian Trust Global/)).toBeInTheDocument();
  });

  it("supports manual re-sync via API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: {
          enabled: true,
          tenantId: "tenant-a",
          endpoints: baseState.endpoints,
          connections: baseState.connections,
          recentEvents: baseState.recentEvents,
        },
        snapshots: baseState.snapshots,
        trustHistory: baseState.trustHistory,
        modelHistory: baseState.modelHistory,
      }),
    });

    render(<AiFederationClient initialState={baseState} />);

    fireEvent.click(screen.getByText(/Manual Re-sync/));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/federation/status",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});
