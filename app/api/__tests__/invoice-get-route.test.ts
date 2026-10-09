import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/invoices/[id]/route";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { db } from "@/lib/db";
import { clearRateLimiters } from "@/lib/rate-limit";

vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/server-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server-telemetry")>()),
  captureServerEvent: vi.fn(),
  captureServerMetric: vi.fn(),
}));
vi.mock("@/lib/audit/auditLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit/auditLogger")>()),
  logAuditEvent: vi.fn(),
}));

const call = (id: string | undefined, headers: Record<string, string> = {}) =>
  GET(
    new Request(`http://localhost/api/invoices/${id ?? ""}`, { headers }) as unknown as NextRequest,
    { params: Promise.resolve(id === undefined ? {} : { id }) },
  );

const membership = (role: "OWNER" | "VIEWER") => ({
  id: "membership-a",
  organizationId: "org-a",
  userId: "user-a",
  role,
  organization: { id: "org-a", name: "Workspace A" },
});

describe("GET /api/invoices/[id] status mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimiters();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-a" },
      expires: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    } as never);
    db.user.findUnique.mockResolvedValue({ id: "user-a", activeOrganizationId: "org-a" } as never);
    db.membership.findUnique.mockResolvedValue(membership("OWNER") as never);
  });

  it("401 Unauthorized without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await call("inv-1");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("400 Missing invoice id when the id param is absent", async () => {
    const response = await call(undefined);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing invoice id" });
  });

  it("403 Workspace access denied without membership", async () => {
    db.membership.findUnique.mockResolvedValueOnce(null);

    const response = await call("inv-1", { "x-organization-id": "org-b" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Workspace access denied" });
  });

  it("404 Invoice not found for an invoice outside the workspace", async () => {
    db.invoice.findFirst.mockResolvedValue(null);

    const response = await call("inv-of-org-b");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Invoice not found" });
  });

  it("200 with { data } for a visible invoice", async () => {
    db.invoice.findFirst.mockResolvedValue({ id: "inv-1", status: "DRAFT", dueAt: null } as never);

    const response = await call("inv-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: "inv-1", status: "DRAFT", dueAt: null } });
  });

  it("passes the request client IP through the route to the auto-overdue audit event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-11-15T10:00:00.000Z"));
    try {
      const row = {
        id: "inv-1",
        number: "INV-001",
        status: "SENT",
        dueAt: new Date("2024-11-10T00:00:00.000Z"),
      };
      db.invoice.findFirst
        .mockResolvedValueOnce(row as never)
        .mockResolvedValueOnce({ ...row, status: "OVERDUE" } as never);
      db.invoice.updateMany.mockResolvedValue({ count: 1 } as never);

      const response = await call("inv-1", { "x-forwarded-for": "198.51.100.23, 10.0.0.1" });

      expect(response.status).toBe(200);
      expect((await response.json()).data.status).toBe("OVERDUE");
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: "inv-1", ipAddress: "198.51.100.23" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
