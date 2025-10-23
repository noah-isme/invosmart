import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NewInvoicePage from "@/app/app/invoices/new/page";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

describe("Invoice manual form", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  it("menampilkan pesan kesalahan ketika field wajib kosong", async () => {
    render(<NewInvoicePage />);

    const submitButton = screen.getByRole("button", { name: /kirim invoice/i });
    fireEvent.click(submitButton);

    expect(await screen.findByText(/Client name required/i)).toBeInTheDocument();
    expect(await screen.findByText(/Item name required/i)).toBeInTheDocument();
  });

  it("menghitung subtotal dan total secara otomatis", () => {
    render(<NewInvoicePage />);

    const qtyInput = screen.getByLabelText(/Jumlah/i);
    fireEvent.change(qtyInput, { target: { value: "2" } });

    const priceInput = screen.getByLabelText(/Harga/i);
    fireEvent.change(priceInput, { target: { value: "500000" } });

    const subtotalValue = screen.getByText(/Subtotal/i).nextElementSibling;
    const taxValue = screen.getByText(/Pajak \(10%\)/i).nextElementSibling;
    const totalValue = screen.getByText(/^Total$/i).nextElementSibling;

    expect(subtotalValue).toHaveTextContent(/Rp\s?1\.000\.000/);
    expect(taxValue).toHaveTextContent(/Rp\s?100\.000/);
    expect(totalValue).toHaveTextContent(/Rp\s?1\.100\.000/);
  });
});
