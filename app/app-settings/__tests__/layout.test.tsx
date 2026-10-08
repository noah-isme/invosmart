import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
);

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import AppSettingsLayout from "../layout";

describe("app-settings layout session gate", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.mocked(getServerSession).mockReset();
  });

  it("redirects to /auth/login when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    await expect(AppSettingsLayout({ children: null })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login",
    );
    expect(redirectMock).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects when the session has no user id", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: {} } as never);
    await expect(AppSettingsLayout({ children: null })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/login",
    );
  });

  it("renders children for an authenticated user", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "u1" },
    } as never);
    const out = await AppSettingsLayout({ children: "child" });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(out).toBeTruthy();
  });
});
