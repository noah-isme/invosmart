import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";

import { db } from "@/lib/db";
import { resolveWorkspaceContextForRequest } from "@/lib/workspaces";
import { GET } from "../audit-logs/route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

// Keep the real resolver by default; individual cases pin a membership role.
vi.mock("@/lib/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspaces")>();
  return {
    ...actual,
    resolveWorkspaceContextForRequest: vi.fn(actual.resolveWorkspaceContextForRequest),
  };
});

const getServerSessionMock = vi.mocked(getServerSession);
const resolveWorkspaceMock = vi.mocked(resolveWorkspaceContextForRequest);

type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

const memberContext = (role: Role) => ({
  userId: "user_1",
  organizationId: "org_1",
  role,
  membership: null,
});

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

    const url = "http://localhost:3000/api/admin/audit-logs?action=INVOICE_CREATE&entity=Invoice&userId=admin_1&tenantId=tenant_a&fromDate=2026-01-01T00:00:00Z&toDate=2026-08-11T00:00:00Z&limit=10&skip=20";
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
        userId: "admin_1",
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

  it("rejects a userId filter for another user in a legacy (no organization) context", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin_1", email: "admin@invosmart.id" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/audit-logs?userId=usr_victim");
    const response = await GET(request);

    expect(response.status).toBe(403);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it.each(["VIEWER", "MEMBER"] as const)(
    "returns 403 for a %s membership (OWNER/ADMIN only)",
    async (role) => {
      getServerSessionMock.mockResolvedValue({ user: { id: "user_1" } });
      resolveWorkspaceMock.mockResolvedValueOnce(memberContext(role));

      const response = await GET(new NextRequest("http://localhost:3000/api/admin/audit-logs"));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Workspace access denied" });
      expect(db.auditLog.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(["ADMIN", "OWNER"] as const)(
    "returns 200 scoped to the organization for an %s membership",
    async (role) => {
      getServerSessionMock.mockResolvedValue({ user: { id: "user_1" } });
      resolveWorkspaceMock.mockResolvedValueOnce(memberContext(role));
      vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
      vi.mocked(db.auditLog.count).mockResolvedValue(0);

      const response = await GET(new NextRequest("http://localhost:3000/api/admin/audit-logs"));

      expect(response.status).toBe(200);
      expect(db.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "org_1" } }),
      );
    },
  );

  it("returns 200 scoped to the caller for a LEGACY (no organization) context", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user_1" } });
    resolveWorkspaceMock.mockResolvedValueOnce({
      userId: "user_1",
      organizationId: null,
      role: "LEGACY",
      membership: null,
    });
    vi.mocked(db.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(db.auditLog.count).mockResolvedValue(0);

    const response = await GET(new NextRequest("http://localhost:3000/api/admin/audit-logs"));

    expect(response.status).toBe(200);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_1" } }),
    );
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
