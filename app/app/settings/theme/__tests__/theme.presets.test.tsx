import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeSettingsPanel } from "@/app/app/settings/theme/ThemeSettingsPanel";
import { DEFAULT_THEME, ThemeContext, type ThemeContextValue } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";

describe("Theme presets", () => {
  it("menerapkan warna preset ke konteks tema", () => {
    const updateTheme = vi.fn();
    const themeValue: ThemeContextValue = {
      ...DEFAULT_THEME,
      updateTheme,
      applyAiTheme: vi.fn(),
      saveTheme: vi.fn(),
      resetTheme: vi.fn(),
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

    fireEvent.click(screen.getByLabelText(/apply oceanic theme/i));

    expect(updateTheme).toHaveBeenCalledWith({ primary: "#0EA5E9", accent: "#22D3EE" });
  });
});
