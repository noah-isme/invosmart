import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingForm } from "@/app/app/settings/branding/BrandingForm";

describe("BrandingForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // @ts-expect-error jsdom override
    global.fetch = fetchMock;
  });

  it("mengirimkan perubahan branding dan menampilkan pesan sukses", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          logoUrl: "https://cdn.brand/logo.png",
          primaryColor: "#334155",
          fontFamily: "serif",
        },
      }),
    });

    render(
      <BrandingForm
        initialBranding={{ logoUrl: "", primaryColor: "#6366f1", fontFamily: "sans" }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/logo url/i), {
      target: { value: "https://cdn.brand/logo.png" },
    });

    fireEvent.change(screen.getByLabelText(/pilih warna utama/i), {
      target: { value: "#334155" },
    });

    fireEvent.change(screen.getByLabelText(/font/i), {
      target: { value: "serif" },
    });

    fireEvent.click(screen.getByRole("button", { name: /simpan/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user/branding",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const lastCall = fetchMock.mock.calls.at(-1);
    const requestInit = lastCall?.[1] as RequestInit;
    const body = requestInit?.body ? JSON.parse(requestInit.body as string) : null;

    expect(body).toEqual({
      logoUrl: "https://cdn.brand/logo.png",
      primaryColor: "#334155",
      fontFamily: "serif",
    });

    expect(
      await screen.findByText(/Branding berhasil diperbarui. PDF terbaru akan menggunakan preferensi ini\./i),
    ).toBeInTheDocument();
  });
});
