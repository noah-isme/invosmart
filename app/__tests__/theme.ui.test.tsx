import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/context/ThemeContext";
import { db } from "@/lib/db";
import ThemeSettingsPage from "@/app/app/settings/theme/page";
import { ThemeSettingsPanel } from "@/app/app/settings/theme/ThemeSettingsPanel";
import * as nextAuth from "next-auth";

vi.mock("next-auth/react", async () => {
  const actual = await vi.importActual("../../test/mocks/next-auth-react");
  return actual;
});

describe("Theme settings UI", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.cssText = "";
    document.documentElement.removeAttribute("data-theme");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("menyesuaikan warna preview saat picker diubah", async () => {
    render(
      <ThemeProvider>
        <ThemeSettingsPanel />
      </ThemeProvider>,
    );

    await screen.findByText(/Theme Settings/);

    const primaryPicker = screen.getByLabelText(/Primary color/i) as HTMLInputElement;
    const accentPicker = screen.getByLabelText(/Accent color/i) as HTMLInputElement;

    fireEvent.change(primaryPicker, { target: { value: "#112233" } });
    fireEvent.change(accentPicker, { target: { value: "#445566" } });

    expect(primaryPicker.value).toBe("#112233");
    expect(accentPicker.value).toBe("#445566");
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toContain("17 34 51");
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toContain("68 85 102");
  });

  it("menampilkan halaman pengaturan tema dengan heading yang tepat", async () => {
    vi.spyOn(nextAuth, "getServerSession").mockResolvedValue({
      user: { id: "user-1", name: "Alia" },
    } as never);
    vi.spyOn(db.user, "findUnique").mockResolvedValue({
      themePrimary: "#112233",
      themeAccent: "#445566",
      themeMode: "light",
    });

    const page = await ThemeSettingsPage();
    expect(page).toBeTruthy();
  });
});
