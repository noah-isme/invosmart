import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeSettingsPanel } from "@/app/app/settings/theme/ThemeSettingsPanel";
import { DEFAULT_THEME, ThemeContext, type ThemeContextValue } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

describe("AI Theme Advisor", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("memanggil API dan menerapkan tema AI", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          primary: "#123456",
          accent: "#abcdef",
          label: "Studio Glow",
          description: "Nuansa energik untuk brand kreatif.",
        },
      }),
    });

    // @ts-expect-error override fetch for test
    global.fetch = fetchMock;

    const applyAiTheme = vi.fn();
    const updateTheme = vi.fn();
    const themeValue: ThemeContextValue = {
      ...DEFAULT_THEME,
      updateTheme,
      saveTheme: vi.fn(),
      resetTheme: vi.fn(),
      applyAiTheme,
      isLoading: false,
      isSaving: false,
    };

    render(
      <ThemeContext.Provider value={themeValue}>
        <ToastProvider>
          <ThemeSettingsPanel initialBrandingSync={false} brandName="Acme" brandLogoUrl={null} />
        </ToastProvider>
      </ThemeContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /dapatkan saran ai/i }));

    await waitFor(() => {
      expect(applyAiTheme).toHaveBeenCalledWith({
        primary: "#123456",
        accent: "#abcdef",
        mode: "dark",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/theme-suggest",
      expect.objectContaining({ method: "POST" }),
    );

    expect(await screen.findByText(/Nuansa energik untuk brand kreatif\./i)).toBeInTheDocument();
    expect(await screen.findByText(/Tema AI berhasil diterapkan/i)).toBeInTheDocument();
  });
});
