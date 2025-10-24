import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIInvoiceGeneratorClient } from "@/app/app/ai-invoice/AIInvoiceGeneratorClient";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

describe("AIInvoiceGeneratorClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error - override fetch for testing
    global.fetch = fetchMock;
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("menampilkan form review setelah draft AI berhasil dibuat", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/invoices/ai") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              client: "PT Kreatif Digital",
              items: [{ name: "Desain Logo", qty: 1, price: 2_000_000 }],
              dueAt: "2024-06-01T00:00:00.000Z",
              notes: "Pembayaran 14 hari setelah invoice diterima.",
            },
          }),
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    render(<AIInvoiceGeneratorClient />);

    const promptInput = screen.getByLabelText(/instruksi ai/i);
    fireEvent.change(promptInput, { target: { value: "Buat invoice desain logo" } });

    const generateButton = screen.getByRole("button", { name: /generate draft/i });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/invoices/ai",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const clientField = await screen.findByDisplayValue("PT Kreatif Digital");
    expect(clientField).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /review draft invoice/i }),
    ).toBeInTheDocument();
  });

  it("memungkinkan menyimpan draft setelah hasil AI muncul", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/invoices/ai") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              client: "PT Kreatif Digital",
              items: [{ name: "Desain Logo", qty: 1, price: 2_000_000 }],
              dueAt: "2024-06-01T00:00:00.000Z",
              notes: "Pembayaran 14 hari setelah invoice diterima.",
            },
          }),
        });
      }

      if (url === "/api/invoices") {
        expect(init?.method).toBe("POST");
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: "inv-ai-1" } }),
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    render(<AIInvoiceGeneratorClient />);

    const promptInput = screen.getByLabelText(/instruksi ai/i);
    fireEvent.change(promptInput, { target: { value: "Buat invoice desain logo" } });

    const generateButton = screen.getByRole("button", { name: /generate draft/i });
    fireEvent.click(generateButton);

    await screen.findByDisplayValue("PT Kreatif Digital");

    const saveDraftButton = screen.getByRole("button", { name: /simpan sebagai draft/i });
    fireEvent.click(saveDraftButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/invoices",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(pushMock).toHaveBeenCalledWith("/app/invoices/inv-ai-1");
    expect(refreshMock).toHaveBeenCalled();
  });
});

