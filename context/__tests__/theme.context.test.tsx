import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/context/ThemeContext";

vi.mock("next-auth/react", async () => {
  const actual = await vi.importActual("../../test/mocks/next-auth-react");
  return actual;
});

describe("ThemeContext", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.cssText = "";
  });

  it("memperbarui warna dan menyimpan ke localStorage", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.updateTheme({ primary: "#123456", accent: "#654321" });
    });

    expect(result.current.primary).toBe("#123456");
    expect(result.current.accent).toBe("#654321");
    expect(window.localStorage.getItem("invosmart.theme")).toContain("#123456");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--color-primary")).not.toBe("");
  });

  it("mengubah mode menjadi light", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;

    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.updateTheme({ mode: "light" });
    });

    expect(result.current.mode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("invosmart.theme")).toContain("light");
  });
});
