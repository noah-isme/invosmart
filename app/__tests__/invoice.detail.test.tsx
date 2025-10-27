import { InvoiceStatus } from "@prisma/client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceDetailClient } from "@/app/app/invoices/[id]/InvoiceDetailClient";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

describe("Invoice detail actions", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("mengubah status menjadi PAID setelah konfirmasi", async () => {
    const invoice = {
      id: "inv-123",
      number: "INV-202411-001",
      client: "PT Kreatif",
      items: [{ name: "Design", qty: 1, price: 1_000_000 }],
      subtotal: 1_000_000,
      tax: 100_000,
      total: 1_100_000,
      status: InvoiceStatus.SENT,
      issuedAt: "2024-11-01T00:00:00.000Z",
      dueAt: "2024-11-15T00:00:00.000Z",
      paidAt: null,
      notes: null,
    } satisfies Parameters<typeof InvoiceDetailClient>[0]["initialInvoice"];

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ...invoice,
          status: InvoiceStatus.PAID,
          paidAt: "2024-11-16T00:00:00.000Z",
        },
      }),
    });

    render(<InvoiceDetailClient initialInvoice={invoice} />);

    fireEvent.click(screen.getByRole("button", { name: /tandai lunas/i }));

    const dialog = await screen.findByRole("alertdialog");
    const confirmButton = within(dialog).getByRole("button", { name: /tandai lunas/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit?.method).toBe("PUT");

    const body = requestInit?.body ? JSON.parse(requestInit.body as string) : null;
    expect(body?.status).toBe(InvoiceStatus.PAID);

    const statusBadges = await screen.findAllByText(/Lunas/i);
    expect(statusBadges.some((element) => element.tagName === "SPAN")).toBe(true);
  });
});
