import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { auditLogMock } = vi.hoisted(() => ({
  auditLogMock: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    auditLog: auditLogMock,
  },
}));

import { getClientIp, logAuditEvent, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";

describe("lib/audit/auditLogger.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getClientIp", () => {
    it("returns null if request is null or undefined", () => {
      expect(getClientIp(null)).toBeNull();
      expect(getClientIp(undefined)).toBeNull();
    });

    it("extracts client IP from x-forwarded-for header", () => {
      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("extracts client IP from x-real-ip header when x-forwarded-for is missing", () => {
      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { "x-real-ip": "198.51.100.1" },
      });
      expect(getClientIp(req)).toBe("198.51.100.1");
    });

    it("falls back to req.ip when headers are empty", () => {
      const req = { ip: "127.0.0.1" } as unknown as Request;
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("returns null if no IP header or property is present", () => {
      const req = new NextRequest("http://localhost:3000/api/test");
      expect(getClientIp(req)).toBeNull();
    });
  });

  describe("logAuditEvent", () => {
    it("persists full audit log entry to database successfully", async () => {
      const mockCreated = {
        id: "log_123",
        tenantId: "tenant_1",
        userId: "usr_1",
        action: AuditAction.INVOICE_CREATE,
        entity: AuditEntity.INVOICE,
        entityId: "inv_99",
        details: { total: 50000 },
        ipAddress: "192.168.1.1",
        createdAt: new Date("2026-08-11T00:00:00Z"),
      };

      auditLogMock.create.mockResolvedValue(mockCreated);

      const result = await logAuditEvent({
        tenantId: "tenant_1",
        userId: "usr_1",
        action: AuditAction.INVOICE_CREATE,
        entity: AuditEntity.INVOICE,
        entityId: "inv_99",
        details: { total: 50000 },
        ipAddress: "192.168.1.1",
      });

      expect(result).toEqual(mockCreated);
      expect(auditLogMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "tenant_1",
          userId: "usr_1",
          action: AuditAction.INVOICE_CREATE,
          entity: AuditEntity.INVOICE,
          entityId: "inv_99",
          ipAddress: "192.168.1.1",
        }),
      });
    });

    it("handles null/undefined optional parameters gracefully", async () => {
      auditLogMock.create.mockResolvedValue({ id: "log_456" });

      await logAuditEvent({
        action: AuditAction.AUTH_LOGIN_SUCCESS,
        entity: AuditEntity.AUTH,
      });

      expect(auditLogMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: null,
          userId: null,
          action: AuditAction.AUTH_LOGIN_SUCCESS,
          entity: AuditEntity.AUTH,
          entityId: null,
        }),
      });
    });

    it("catches errors non-blockingly and returns null on database failure", async () => {
      auditLogMock.create.mockRejectedValue(new Error("Database error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await logAuditEvent({
        action: AuditAction.AI_AUTO_ACTION,
        entity: AuditEntity.AI_AUTO_ACTION,
      });

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
