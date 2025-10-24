import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { RevenueInsightView } from "@/app/app/dashboard/insight/components/RevenueInsightView";
import type { RevenueInsight } from "@/lib/analytics";

vi.mock("recharts", () => {
  const MockChart = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  const MockPrimitive = () => <div />;

  return {
    ResponsiveContainer: MockChart,
    LineChart: MockChart,
    BarChart: MockChart,
    CartesianGrid: MockPrimitive,
    Tooltip: MockPrimitive,
    Legend: MockPrimitive,
    Line: MockPrimitive,
    Bar: MockPrimitive,
    XAxis: MockPrimitive,
    YAxis: MockPrimitive,
  };
});

describe("RevenueInsightView", () => {
  const mockInsight: RevenueInsight = {
    months: ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
    revenue: [1_000_000, 800_000, 0, 1_200_000, 900_000, 1_500_000],
    paid: [3, 2, 1, 4, 2, 5],
    overdue: [0, 1, 2, 0, 0, 1],
    topClient: { client: "PT Nusantara", averageDays: 3.5 },
    overdueClients: ["PT Garuda", "PT Samudra"],
  };

  it("renders chart sections and summary cards", () => {
    render(<RevenueInsightView insight={mockInsight} />);

    expect(
      screen.getByRole("heading", { name: /Monthly Revenue \(Last 6 Months\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Paid vs Overdue invoices/i })).toBeInTheDocument();
    expect(screen.getByText(/PT Nusantara/)).toBeInTheDocument();
    expect(screen.getByText(/3.5 hari/)).toBeInTheDocument();
    expect(screen.getByText(/PT Garuda/)).toBeInTheDocument();
    expect(screen.getByText(/PT Samudra/)).toBeInTheDocument();
  });
});
