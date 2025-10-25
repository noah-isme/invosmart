import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/context/ThemeContext";
import { ThemeSettingsPanel } from "@/app/app/settings/theme/ThemeSettingsPanel";

vi.mock("next-auth/react", async () => {
  const actual = await vi.importActual("../../test/mocks/next-auth-react");
  return actual;
});

describe("Theme mode switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.cssText = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("mengubah atribut data-theme tanpa menghilangkan konten", async () => {
    render(
      <ThemeProvider>
        <ThemeSettingsPanel />
      </ThemeProvider>,
    );

    await screen.findByText(/Theme Settings/);
    const select = screen.getByLabelText(/Mode tampilan/i) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "light" } });

    expect(select.value).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByText(/Theme Settings/)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
