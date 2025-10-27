import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandingForm } from "@/app/app/settings/branding/BrandingForm";
import { DEFAULT_THEME, ThemeContext, type ThemeContextValue } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

describe("Branding sync toggle", () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  afterEach(() => {
    fetchMock.mockReset();
    global.fetch = originalFetch;
  });

  it("menonaktifkan input manual dan mengirim payload sinkronisasi", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          logoUrl: null,
          primaryColor: DEFAULT_THEME.primary,
          fontFamily: "sans",
          brandingSyncWithTheme: true,
        },
      }),
    });
    global.fetch = fetchMock;

    const themeValue: ThemeContextValue = {
      ...DEFAULT_THEME,
      updateTheme: vi.fn(),
      saveTheme: vi.fn(),
      resetTheme: vi.fn(),
      applyAiTheme: vi.fn(),
      isLoading: false,
      isSaving: false,
    };

    render(
      <ThemeContext.Provider value={themeValue}>
        <ToastProvider>
          <BrandingForm
            initialBranding={{
              logoUrl: "",
              primaryColor: "#334155",
              fontFamily: "sans",
              syncWithTheme: false,
              useThemeForPdf: false,
            }}
          />
        </ToastProvider>
      </ThemeContext.Provider>,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: /Gunakan warna tema sebagai warna branding/i }),
    );

    expect(screen.getByLabelText(/Pilih warna utama/i)).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Simpan perubahan/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/user/branding",
        expect.objectContaining({ method: "PUT" }),
      );
    });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      logoUrl: null,
      primaryColor: DEFAULT_THEME.primary,
      fontFamily: "sans",
      syncWithTheme: true,
      useThemeForPdf: false,
    });
  });
});
