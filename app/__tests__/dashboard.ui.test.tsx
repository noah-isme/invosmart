import { InvoiceStatus } from "@prisma/client";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceFilterValue } from "@/app/app/dashboard/components/types";
import { DashboardContent } from "@/app/app/dashboard/components/DashboardContent";

const invoices = [
  {
    id: "inv-1",
    number: "INV-202411-001",
    client: "PT Kreatif",
    items: [
      { name: "Design", qty: 2, price: 500_000 },
    ],
    subtotal: 1_000_000,
    tax: 100_000,
    total: 1_100_000,
    status: InvoiceStatus.UNPAID,
    issuedAt: "2024-11-10T00:00:00.000Z",
    dueAt: "2024-11-25T00:00:00.000Z",
    paidAt: null,
    notes: null,
  },
  {
    id: "inv-2",
    number: "INV-202411-002",
    client: "PT Digital",
    items: [
      { name: "Development", qty: 1, price: 2_500_000 },
    ],
    subtotal: 2_500_000,
    tax: 250_000,
    total: 2_750_000,
    status: InvoiceStatus.SENT,
    issuedAt: "2024-11-12T00:00:00.000Z",
    dueAt: "2024-11-30T00:00:00.000Z",
    paidAt: null,
    notes: null,
  },
];

const stats = {
  revenue: 3_000_000,
  unpaid: 1,
  overdue: 0,
};

let fetchMock: ReturnType<typeof vi.fn>;
let triggerFilterChange: ((value: InvoiceFilterValue) => void) | undefined;

vi.mock("@/app/app/dashboard/components/InvoiceFilter", () => ({
  InvoiceFilter: (props: {
    value: InvoiceFilterValue;
    onChange: (value: InvoiceFilterValue) => void;
  }) => {
    triggerFilterChange = props.onChange;
    return <div data-testid="invoice-filter-stub" />;
  },
}));

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: invoices, stats }),
  });

  global.fetch = fetchMock;
  triggerFilterChange = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardContent", () => {
  it("menampilkan tabel invoice dan statistik ringkas", async () => {
    render(<DashboardContent />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/invoices");
    });

    const invoiceNumbers = await screen.findAllByText(/INV-202411-001/);
    expect(invoiceNumbers.length).toBeGreaterThan(0);
    expect(screen.getByText(/Total pendapatan/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice belum dibayar/i)).toHaveTextContent("Invoice belum dibayar");
  });

  it("melakukan fetch ulang ketika filter status berubah", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("status=PAID")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [], stats }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ data: invoices, stats }),
      });
    });

    render(<DashboardContent />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(typeof triggerFilterChange).toBe("function");

    await act(async () => {
      triggerFilterChange?.("PAID");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/invoices?status=PAID");

    await waitFor(() => {
      expect(screen.getByText(/Menampilkan invoice dengan status Paid/i)).toBeInTheDocument();
    });
  });
});
