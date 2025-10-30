import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AgentGraphClient from "@/app/devtools/ai-agents/AgentGraphClient";
import type { AgentRegistration } from "@/lib/ai/orchestrator";
import type { MapEvent } from "@/lib/ai/protocol";

vi.mock("reactflow", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="react-flow">{children}</div>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

describe("AgentGraphClient", () => {
  const agents: AgentRegistration[] = [
    {
      agentId: "optimizer",
      name: "OptimizerAgent",
      description: "",
      capabilities: ["recommendation"],
      priority: 75,
      streamKey: "ai:orchestrator:events:optimizer",
      registeredAt: new Date().toISOString(),
    },
    {
      agentId: "learning",
      name: "LearningAgent",
      description: "",
      capabilities: ["evaluation"],
      priority: 60,
      streamKey: "ai:orchestrator:events:learning",
      registeredAt: new Date().toISOString(),
    },
  ];

  const events: MapEvent[] = [
    {
      traceId: "trace-1",
      type: "recommendation",
      source: "optimizer",
      target: "governance",
      priority: 75,
      timestamp: new Date().toISOString(),
      payload: {
        summary: "Optimasi route",
        recommendationId: "rec-1",
        route: "/app",
        confidence: 0.8,
        impact: "Kurangi blocking asset",
      },
    },
    {
      traceId: "trace-1",
      type: "evaluation",
      source: "learning",
      target: "governance",
      priority: 60,
      timestamp: new Date(Date.now() + 1000).toISOString(),
      payload: {
        summary: "Evaluasi route",
        recommendationId: "rec-1",
        status: "approved",
        compositeImpact: 0.2,
        rollbackTriggered: false,
        confidence: 0.85,
      },
    },
  ];

  it("renders nodes, logs, and conflict filter", () => {
    render(<AgentGraphClient enabled agents={agents} events={events} conflicts={[]} />);

    expect(screen.getByText(/Multi-agent orchestration/i)).toBeInTheDocument();
    expect(screen.getByTestId("react-flow")).toBeInTheDocument();
    expect(screen.getByText(/Optimasi route/i)).toBeInTheDocument();
  });

  it("filters events when conflict toggle is enabled", () => {
    render(
      <AgentGraphClient
        enabled
        agents={agents}
        events={events}
        conflicts={[{ traceId: "trace-1", winningEvent: events[1] }]}
      />,
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(screen.getAllByText(/trace trace-1/i).length).toBe(1);
  });
});
