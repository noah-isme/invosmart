import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InsightClient } from "@/app/app/insight/InsightClient";
import type { RevenueInsight } from "@/lib/analytics";
import type { InvoiceInsightSummary } from "@/lib/schemas";

const notify = vi.fn();

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ notify }),
}));

const summary: InvoiceInsightSummary = {
  totals: {
    revenue: 30_000_000,
    paidInvoices: 10,
    overdueInvoices: 1,
    outstandingInvoices: 2,
    averageInvoice: 3_000_000,
  },
  monthlyRevenue: [
    { month: "Jul", revenue: 7_000_000, paid: 2, overdue: 1 },
    { month: "Aug", revenue: 8_000_000, paid: 3, overdue: 0 },
    { month: "Sep", revenue: 9_000_000, paid: 3, overdue: 0 },
    { month: "Oct", revenue: 6_000_000, paid: 2, overdue: 0 },
  ],
  topClients: [
    { client: "PT Kreatif", revenue: 12_000_000, paidInvoices: 4, overdueInvoices: 0 },
    { client: "PT Nusantara", revenue: 9_000_000, paidInvoices: 3, overdueInvoices: 1 },
  ],
  recentInvoices: [],
  period: {
    label: "Jul – Oct",
    months: ["Jul", "Aug", "Sep", "Oct"],
    currency: "IDR",
  },
  trend: {
    lastMonth: 6_000_000,
    previousMonth: 9_000_000,
  },
};

const revenueInsight: RevenueInsight = {
  months: summary.period.months,
  revenue: summary.monthlyRevenue.map((entry) => entry.revenue),
  paid: summary.monthlyRevenue.map((entry) => entry.paid),
  overdue: summary.monthlyRevenue.map((entry) => entry.overdue),
  topClient: null,
  overdueClients: [],
};

describe("InsightClient", () => {
  it("renders AI insight and top clients", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          totalRevenue: "Rp 30.000.000",
          topClient: "PT Kreatif",
          insight: "Pendapatan stabil dengan dukungan klien kreatif.",
          recommendation: "Kirim paket loyalitas untuk menjaga momentum pembayaran.",
        },
        fallback: false,
      }),
    });

    // @ts-expect-error - override global fetch for testing
    global.fetch = fetchMock;

    render(<InsightClient summary={summary} revenueInsight={revenueInsight} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await waitFor(() => {
      expect(screen.getByText(/Klien utama: PT Kreatif/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/30\.000\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Kirim paket loyalitas/i)).toBeInTheDocument();

    const regenerate = screen.getByRole("button", { name: /Regenerate Insight/i });
    fireEvent.click(regenerate);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
