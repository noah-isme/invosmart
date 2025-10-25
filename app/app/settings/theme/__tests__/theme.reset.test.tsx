import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemeSettingsPanel } from "@/app/app/settings/theme/ThemeSettingsPanel";
import { DEFAULT_THEME, ThemeContext, type ThemeContextValue } from "@/context/ThemeContext";

describe("Theme reset", () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  afterEach(() => {
    fetchMock.mockReset();
    global.fetch = originalFetch;
  });

  it("mereset tema ke default dan menyinkronkan branding", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    const resetTheme = vi.fn().mockResolvedValue(undefined);
    const themeValue: ThemeContextValue = {
      ...DEFAULT_THEME,
      updateTheme: vi.fn(),
      saveTheme: vi.fn(),
      resetTheme,
      isLoading: false,
      isSaving: false,
    };

    render(
      <ThemeContext.Provider value={themeValue}>
        <ThemeSettingsPanel initialBrandingSync={true} />
      </ThemeContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /reset ke tema default/i }));

    await waitFor(() => {
      expect(resetTheme).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/user/branding",
      expect.objectContaining({ method: "PATCH" }),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ primaryColor: DEFAULT_THEME.primary });
    expect(await screen.findByText(/Tema berhasil direset ke default\./i)).toBeInTheDocument();
  });
});
