import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingForm } from "@/app/app/settings/branding/BrandingForm";
import { DEFAULT_THEME, ThemeContext, type ThemeContextValue } from "@/context/ThemeContext";

describe("BrandingForm", () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    // @ts-expect-error jsdom override
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("mengirimkan perubahan branding dan menampilkan pesan sukses", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          logoUrl: "https://cdn.brand/logo.png",
          primaryColor: "#334155",
          fontFamily: "serif",
          brandingSyncWithTheme: false,
        },
      }),
    });

    const themeValue: ThemeContextValue = {
      ...DEFAULT_THEME,
      updateTheme: vi.fn(),
      saveTheme: vi.fn(),
      resetTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    };

    render(
      <ThemeContext.Provider value={themeValue}>
        <BrandingForm
          initialBranding={{ logoUrl: "", primaryColor: "#6366f1", fontFamily: "sans", syncWithTheme: false }}
        />
      </ThemeContext.Provider>,
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

    fireEvent.click(screen.getByRole("button", { name: /simpan perubahan/i }));

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
      syncWithTheme: false,
    });

    expect(
      await screen.findByText(/Branding berhasil diperbarui. PDF terbaru akan menggunakan preferensi ini\./i),
    ).toBeInTheDocument();
  });
});
