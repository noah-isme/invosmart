import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { GET } from "../audit-logs/route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

const getServerSessionMock = vi.mocked(getServerSession);

describe("GET /api/admin/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized when session is missing", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/admin/audit-logs");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 Unauthorized when session user is missing", async () => {
    getServerSessionMock.mockResolvedValue({});

    const request = new NextRequest("http://localhost:3000/api/admin/audit-logs");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns audit logs and total count when authenticated", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin_1", email: "admin@invosmart.id" },
    });

    const mockLogs = [
      {
        id: "log_1",
        tenantId: "tenant_a",
        userId: "usr_1",
        action: "INVOICE_CREATE",
        entity: "Invoice",
        entityId: "inv_100",
        details: { number: "INV-001" },
        ipAddress: "127.0.0.1",
        createdAt: new Date(),
        user: { id: "usr_1", email: "user@invosmart.id", name: "John Doe" },
      },
    ];

    vi.mocked(db.auditLog.findMany).mockResolvedValue(mockLogs as never);
    vi.mocked(db.auditLog.count).mockResolvedValue(1);

    const request = new NextRequest("http://localhost:3000/api/admin/audit-logs");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs.length).toBe(1);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.skip).toBe(0);
  });

  it("applies query filters, date range, and custom limit/skip parameters", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin_1", email: "admin@invosmart.id" },
    });

    vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(db.auditLog.count).mockResolvedValue(0);

    const url = "http://localhost:3000/api/admin/audit-logs?action=INVOICE_CREATE&entity=Invoice&userId=usr_1&tenantId=tenant_a&fromDate=2026-01-01T00:00:00Z&toDate=2026-08-11T00:00:00Z&limit=10&skip=20";
    const request = new NextRequest(url);
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.skip).toBe(20);

    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        action: "INVOICE_CREATE",
        entity: "Invoice",
        userId: "usr_1",
        tenantId: "tenant_a",
        createdAt: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
      }),
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 20,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  });

  it("returns 500 when database query throws an error", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin_1" },
    });

    vi.mocked(db.auditLog.findMany).mockRejectedValue(new Error("DB failure"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const request = new NextRequest("http://localhost:3000/api/admin/audit-logs");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });

    consoleSpy.mockRestore();
  });
});
