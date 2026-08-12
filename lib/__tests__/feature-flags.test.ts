import type { FeatureFlag } from "@prisma/client";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  deleteFlag,
  getAllFlags,
  getFlag,
  toggleFlag,
  upsertFlag,
} from "@/lib/feature-flags";

vi.mock("@/lib/db", () => ({
  db: {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const getServerSessionMock = vi.mocked(getServerSession);

const createMockFlag = (overrides: Partial<FeatureFlag> = {}): FeatureFlag => ({
  id: "ff-1",
  key: "test_flag",
  name: "Test Flag",
  description: null,
  enabled: true,
  targetTenants: null,
  targetUsers: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("Feature Flags System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getFlag evaluation logic", () => {
    it("returns default true for known flag 'bayesian_ab_overlay' if not found in DB", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(null);

      const result = await getFlag("bayesian_ab_overlay");
      expect(result).toBe(true);
      expect(db.featureFlag.findUnique).toHaveBeenCalledWith({
        where: { key: "bayesian_ab_overlay" },
      });
    });

    it("returns default false for unknown flag if not found in DB", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(null);

      const result = await getFlag("unknown_feature_xyz");
      expect(result).toBe(false);
    });

    it("returns true if flag is enabled globally in DB", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({ key: "new_checkout", name: "New Checkout UI", enabled: true })
      );

      const result = await getFlag("new_checkout");
      expect(result).toBe(true);
    });

    it("returns false if flag is disabled in DB and no target scope matches", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({ key: "new_checkout", name: "New Checkout UI", enabled: false })
      );

      const result = await getFlag("new_checkout", { tenantId: "tenant-999" });
      expect(result).toBe(false);
    });

    it("returns true if flag is disabled globally BUT matches targetTenants in context", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({
          key: "beta_feature",
          name: "Beta Feature",
          enabled: false,
          targetTenants: ["tenant-alpha", "tenant-beta"],
        })
      );

      const resultMatched = await getFlag("beta_feature", { tenantId: "tenant-alpha" });
      expect(resultMatched).toBe(true);
    });

    it("returns false if flag is disabled globally and targetTenants does NOT match context", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({
          key: "beta_feature",
          name: "Beta Feature",
          enabled: false,
          targetTenants: ["tenant-alpha"],
        })
      );

      const resultUnmatched = await getFlag("beta_feature", { tenantId: "tenant-gamma" });
      expect(resultUnmatched).toBe(false);
    });

    it("returns true if flag is disabled globally BUT matches targetUsers in context", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({
          key: "vip_dashboard",
          name: "VIP Dashboard",
          enabled: false,
          targetUsers: ["user-100", "user-200"],
        })
      );

      const resultUserMatched = await getFlag("vip_dashboard", { userId: "user-200" });
      expect(resultUserMatched).toBe(true);
    });

    it("returns false if flag is disabled globally and targetUsers does NOT match context", async () => {
      vi.mocked(db.featureFlag.findUnique).mockResolvedValueOnce(
        createMockFlag({
          key: "vip_dashboard",
          name: "VIP Dashboard",
          enabled: false,
          targetUsers: ["user-100"],
        })
      );

      const resultUserUnmatched = await getFlag("vip_dashboard", { userId: "user-300" });
      expect(resultUserUnmatched).toBe(false);
    });

    it("handles DB error gracefully by returning default fallback", async () => {
      vi.mocked(db.featureFlag.findUnique).mockRejectedValueOnce(new Error("DB Connection Error"));

      const result = await getFlag("bayesian_ab_overlay");
      expect(result).toBe(true);
    });
  });

  describe("Helper Functions", () => {
    it("getAllFlags fetches all flags from DB", async () => {
      const mockFlags = [
        createMockFlag({ id: "1", key: "f1", name: "F1", enabled: true }),
        createMockFlag({ id: "2", key: "f2", name: "F2", enabled: false }),
      ];
      vi.mocked(db.featureFlag.findMany).mockResolvedValueOnce(mockFlags);

      const result = await getAllFlags();
      expect(result).toEqual(mockFlags);
      expect(db.featureFlag.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: "desc" },
      });
    });

    it("upsertFlag creates or updates flag by key when no id provided", async () => {
      const input = {
        key: "new_flag",
        name: "New Flag",
        description: "Desc",
        enabled: true,
        targetTenants: ["tenant-1"],
      };
      const mockResult = createMockFlag({ id: "ff-new", ...input });
      vi.mocked(db.featureFlag.upsert).mockResolvedValueOnce(mockResult);

      const result = await upsertFlag(input);
      expect(result).toEqual(mockResult);
      expect(db.featureFlag.upsert).toHaveBeenCalledWith({
        where: { key: "new_flag" },
        create: expect.objectContaining({ key: "new_flag", name: "New Flag" }),
        update: expect.objectContaining({ name: "New Flag" }),
      });
    });

    it("upsertFlag updates flag by id when id provided", async () => {
      const input = {
        id: "ff-existing",
        key: "new_flag",
        name: "Updated Flag Name",
        enabled: false,
      };
      const mockResult = createMockFlag({ ...input });
      vi.mocked(db.featureFlag.update).mockResolvedValueOnce(mockResult);

      const result = await upsertFlag(input);
      expect(result).toEqual(mockResult);
      expect(db.featureFlag.update).toHaveBeenCalledWith({
        where: { id: "ff-existing" },
        data: expect.objectContaining({ name: "Updated Flag Name", enabled: false }),
      });
    });

    it("toggleFlag updates enabled field by id", async () => {
      const mockResult = createMockFlag({ id: "ff-1", key: "f1", name: "F1", enabled: false });
      vi.mocked(db.featureFlag.update).mockResolvedValueOnce(mockResult);

      const result = await toggleFlag("ff-1", false);
      expect(result).toEqual(mockResult);
      expect(db.featureFlag.update).toHaveBeenCalledWith({
        where: { id: "ff-1" },
        data: { enabled: false },
      });
    });

    it("deleteFlag deletes record by id", async () => {
      const mockResult = createMockFlag({ id: "ff-1", key: "f1" });
      vi.mocked(db.featureFlag.delete).mockResolvedValueOnce(mockResult);

      const result = await deleteFlag("ff-1");
      expect(result).toEqual(mockResult);
      expect(db.featureFlag.delete).toHaveBeenCalledWith({
        where: { id: "ff-1" },
      });
    });
  });

  describe("Admin API Route: /api/admin/feature-flags", () => {
    it("returns 401 GET when unauthorized", async () => {
      const { GET } = await import("@/app/api/admin/feature-flags/route");
      getServerSessionMock.mockResolvedValueOnce(null);

      const response = await GET();
      expect(response.status).toBe(401);
    });

    it("returns list of flags GET when authorized", async () => {
      const { GET } = await import("@/app/api/admin/feature-flags/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-1" },
      } as Session);

      const mockFlags = [createMockFlag({ id: "ff-1", key: "f1", name: "Flag 1", enabled: true })];
      vi.mocked(db.featureFlag.findMany).mockResolvedValueOnce(mockFlags);

      const response = await GET();
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toMatchObject({ id: "ff-1", key: "f1", name: "Flag 1", enabled: true });
    });

    it("POST creates/updates flag when authorized", async () => {
      const { POST } = await import("@/app/api/admin/feature-flags/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-1" },
      } as Session);

      const createdFlag = createMockFlag({ id: "ff-new", key: "test_flag", name: "Test Flag", enabled: true });
      vi.mocked(db.featureFlag.upsert).mockResolvedValueOnce(createdFlag);

      const req = new NextRequest("http://localhost/api/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({ key: "test_flag", name: "Test Flag" }),
      });

      const response = await POST(req);
      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.data.key).toBe("test_flag");
    });

    it("POST toggles enabled state when id and enabled provided", async () => {
      const { POST } = await import("@/app/api/admin/feature-flags/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-1" },
      } as Session);

      const updatedFlag = createMockFlag({ id: "ff-1", key: "f1", name: "F1", enabled: false });
      vi.mocked(db.featureFlag.update).mockResolvedValueOnce(updatedFlag);

      const req = new NextRequest("http://localhost/api/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({ id: "ff-1", enabled: false }),
      });

      const response = await POST(req);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data.enabled).toBe(false);
    });

    it("DELETE removes flag by query param or body id", async () => {
      const { DELETE } = await import("@/app/api/admin/feature-flags/route");
      getServerSessionMock.mockResolvedValueOnce({
        user: { id: "admin-1" },
      } as Session);

      vi.mocked(db.featureFlag.delete).mockResolvedValueOnce(createMockFlag({ id: "ff-1" }));

      const req = new NextRequest("http://localhost/api/admin/feature-flags?id=ff-1", {
        method: "DELETE",
      });

      const response = await DELETE(req);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(db.featureFlag.delete).toHaveBeenCalledWith({ where: { id: "ff-1" } });
    });
  });
});
