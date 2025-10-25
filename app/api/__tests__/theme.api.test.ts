import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { GET, PUT } from "@/app/api/user/theme/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth";

describe("/api/user/theme", () => {
  const mockSession = getServerSession as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("mengembalikan tema pengguna aktif", async () => {
      mockSession.mockResolvedValue({ user: { id: "user-1" } });
      vi.spyOn(db.user, "findUnique").mockResolvedValue({
        themePrimary: "#123abc",
        themeAccent: "#abcdef",
        themeMode: "light",
      });

      const response = await GET(new Request("http://localhost/api/user/theme"));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          primary: "#123abc",
          accent: "#abcdef",
          mode: "light",
        },
      });
    });

    it("mengembalikan 401 ketika sesi tidak ditemukan", async () => {
      mockSession.mockResolvedValue(null);

      const response = await GET(new Request("http://localhost/api/user/theme"));

      expect(response.status).toBe(401);
    });
  });

  describe("PUT", () => {
    it("menyimpan warna dan mode ketika payload valid", async () => {
      mockSession.mockResolvedValue({ user: { id: "user-1" } });

      const updateSpy = vi.spyOn(db.user, "update").mockResolvedValue({
        themePrimary: "#112233",
        themeAccent: "#445566",
        themeMode: "dark",
      });

      const request = new Request("http://localhost/api/user/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themePrimary: "#112233",
          themeAccent: "#445566",
          themeMode: "dark",
        }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: {
          themePrimary: "#112233",
          themeAccent: "#445566",
          themeMode: "dark",
        },
        select: { themePrimary: true, themeAccent: true, themeMode: true },
      });
      await expect(response.json()).resolves.toEqual({
        data: {
          primary: "#112233",
          accent: "#445566",
          mode: "dark",
        },
      });
    });

    it("menolak hex yang tidak valid", async () => {
      mockSession.mockResolvedValue({ user: { id: "user-1" } });

      const request = new Request("http://localhost/api/user/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePrimary: "ungu" }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("tidak valid") });
    });

    it("mengembalikan 401 ketika tidak ada sesi", async () => {
      mockSession.mockResolvedValue(null);

      const request = new Request("http://localhost/api/user/theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePrimary: "#112233" }),
      });

      const response = await PUT(request);

      expect(response.status).toBe(401);
    });
  });
});
