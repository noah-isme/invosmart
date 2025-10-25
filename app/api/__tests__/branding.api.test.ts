import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { PUT } from "@/app/api/user/branding/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";

type BrandingSelection = {
  logoUrl: string | null;
  primaryColor: string | null;
  fontFamily: string | null;
  brandingSyncWithTheme: boolean;
};

describe("PUT /api/user/branding", () => {
  const mockSession = getServerSession as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("memperbarui branding ketika payload valid", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1" } });

    const updateSpy = vi.spyOn(db.user, "update").mockResolvedValue({
      logoUrl: "https://cdn.brand/logo.png",
      primaryColor: "#123abc",
      fontFamily: "mono",
      brandingSyncWithTheme: true,
    } satisfies BrandingSelection);

    const request = new Request("http://localhost/api/user/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logoUrl: " https://cdn.brand/logo.png ",
        primaryColor: "#123ABC",
        fontFamily: "mono",
        syncWithTheme: true,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        logoUrl: "https://cdn.brand/logo.png",
        primaryColor: "#123abc",
        fontFamily: "mono",
        brandingSyncWithTheme: true,
      },
      select: { logoUrl: true, primaryColor: true, fontFamily: true, brandingSyncWithTheme: true },
    });

    const payload = await response.json();
    expect(payload).toEqual({
      data: {
        logoUrl: "https://cdn.brand/logo.png",
        primaryColor: "#123abc",
        fontFamily: "mono",
        brandingSyncWithTheme: true,
      },
    });
  });

  it("mengembalikan 400 untuk warna hex tidak valid", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1" } });

    const request = new Request("http://localhost/api/user/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryColor: "biru",
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("tidak valid") });
  });

  it("mengembalikan 401 ketika tidak ada sesi", async () => {
    mockSession.mockResolvedValue(null);

    const request = new Request("http://localhost/api/user/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await PUT(request);

    expect(response.status).toBe(401);
  });
});
