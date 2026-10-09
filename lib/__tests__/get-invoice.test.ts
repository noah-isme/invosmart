import { getServerSession } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logAuditEvent } from "@/lib/audit/auditLogger";
import { db } from "@/lib/db";
import { getInvoiceForCurrentUser } from "@/lib/invoices/get-invoice";
import { captureServerEvent } from "@/lib/server-telemetry";

vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/server-telemetry", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/audit/auditLogger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audit/auditLogger")>()),
  logAuditEvent: vi.fn(),
}));

const sessionFor = (userId: string) =>
  ({
    user: { id: userId },
    expires: new Date("2030-01-01T00:00:00.000Z").toISOString(),
  }) as never;

const membership = (role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER", organizationId = "org-a") => ({
  id: `membership-${organizationId}`,
  organizationId,
  userId: "user-a",
  role,
  organization: { id: organizationId, name: `Workspace ${organizationId}` },
});

const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  number: "INV-001",
  client: "PT Kreatif",
  items: [{ name: "Service", qty: 1, price: 1000 }],
  subtotal: 1000,
  tax: 0,
  total: 1000,
  status: "DRAFT",
  issuedAt: new Date("2024-11-01T00:00:00.000Z"),
  dueAt: null,
  paidAt: null,
  notes: null,
  userId: "user-a",
  organizationId: "org-a",
  ...overrides,
});

describe("getInvoiceForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(sessionFor("user-a"));
    db.user.findUnique.mockResolvedValue({ id: "user-a", activeOrganizationId: "org-a" } as never);
    db.membership.findUnique.mockResolvedValue(membership("OWNER") as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns the invoice to its workspace owner, scoped by organization", async () => {
    const row = invoiceRow();
    db.invoice.findFirst.mockResolvedValue(row as never);

    const result = await getInvoiceForCurrentUser({ id: "inv-1" });

    expect(result).toEqual({ ok: true, invoice: row });
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "inv-1", organizationId: "org-a" },
    });
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it("returns not_found for an invoice that belongs to another workspace", async () => {
    // Scoped query never matches rows of another workspace.
    db.invoice.findFirst.mockResolvedValue(null);

    const result = await getInvoiceForCurrentUser({ id: "inv-of-org-b" });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(db.invoice.findFirst).toHaveBeenCalledWith({
      where: { id: "inv-of-org-b", organizationId: "org-a" },
    });
  });

  it("rejects a requested workspace without a matching membership as forbidden", async () => {
    db.membership.findUnique.mockResolvedValueOnce(null);

    const result = await getInvoiceForCurrentUser({
      id: "inv-1",
      requestedOrganizationId: "org-b",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it.each(["VIEWER", "MEMBER", "ADMIN"] as const)("lets a %s read the invoice", async (role) => {
    db.membership.findUnique.mockResolvedValue(membership(role) as never);
    const row = invoiceRow();
    db.invoice.findFirst.mockResolvedValue(row as never);

    const result = await getInvoiceForCurrentUser({ id: "inv-1" });

    expect(result).toEqual({ ok: true, invoice: row });
  });

  it("returns unauthorized without a session and touches no data", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

    const result = await getInvoiceForCurrentUser({ id: "inv-1" });

    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("returns invalid_id for a missing id after authorization", async () => {
    const result = await getInvoiceForCurrentUser({ id: null });

    expect(result).toEqual({ ok: false, reason: "invalid_id" });
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed when membership is unresolved in enforce mode", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "enforce");
    db.user.findUnique.mockResolvedValue({ id: "user-a", activeOrganizationId: null } as never);
    db.membership.findFirst.mockResolvedValue(null as never);

    const result = await getInvoiceForCurrentUser({ id: "inv-1" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(db.invoice.findFirst).not.toHaveBeenCalled();
  });

  describe("lazy OVERDUE transition", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-11-15T10:00:00.000Z"));
    });

    it("marks a past-due SENT invoice OVERDUE atomically, re-reads it and audits once", async () => {
      const row = invoiceRow({ status: "SENT", dueAt: new Date("2024-11-10T00:00:00.000Z") });
      const updated = { ...row, status: "OVERDUE" };
      db.invoice.findFirst.mockResolvedValueOnce(row as never).mockResolvedValueOnce(updated as never);
      db.invoice.updateMany.mockResolvedValue({ count: 1 } as never);

      const result = await getInvoiceForCurrentUser({ id: "inv-1", ipAddress: "203.0.113.7" });

      expect(result).toEqual({ ok: true, invoice: updated });
      expect(db.invoice.update).not.toHaveBeenCalled();
      expect(db.invoice.updateMany).toHaveBeenCalledWith({
        where: {
          id: "inv-1",
          organizationId: "org-a",
          status: { in: ["SENT", "UNPAID"] },
          dueAt: { lt: new Date("2024-11-15T10:00:00.000Z") },
        },
        data: { status: "OVERDUE" },
      });
      expect(captureServerEvent).toHaveBeenCalledTimes(1);
      expect(captureServerEvent).toHaveBeenCalledWith("invoice_status_auto_overdue", {
        invoiceId: "inv-1",
      });
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "org-a",
          userId: "user-a",
          entityId: "inv-1",
          ipAddress: "203.0.113.7",
          details: expect.objectContaining({
            previousStatus: "SENT",
            nextStatus: "OVERDUE",
            trigger: "lazy_get_evaluation",
          }),
        }),
      );
    });

    it("emits no audit or telemetry and returns the current row when the compare-and-set matches 0 rows", async () => {
      // Another view already flipped it, or a PUT marked it PAID in between.
      const stale = invoiceRow({ status: "SENT", dueAt: new Date("2024-11-10T00:00:00.000Z") });
      const paid = { ...stale, status: "PAID", paidAt: new Date("2024-11-15T09:59:59.000Z") };
      db.invoice.findFirst.mockResolvedValueOnce(stale as never).mockResolvedValueOnce(paid as never);
      db.invoice.updateMany.mockResolvedValue({ count: 0 } as never);

      const result = await getInvoiceForCurrentUser({ id: "inv-1" });

      expect(result).toEqual({ ok: true, invoice: paid });
      expect(result.ok && result.invoice.status).toBe("PAID");
      expect(db.invoice.update).not.toHaveBeenCalled();
      expect(captureServerEvent).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it("returns not_found if the invoice was deleted between the check and the re-read", async () => {
      const row = invoiceRow({ status: "UNPAID", dueAt: new Date("2024-11-10T00:00:00.000Z") });
      db.invoice.findFirst.mockResolvedValueOnce(row as never).mockResolvedValueOnce(null);
      db.invoice.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(getInvoiceForCurrentUser({ id: "inv-1" })).resolves.toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("does not transition a PAID invoice or one that is not yet due", async () => {
      db.invoice.findFirst.mockResolvedValueOnce(
        invoiceRow({ status: "PAID", dueAt: new Date("2024-11-10T00:00:00.000Z") }) as never,
      );
      await getInvoiceForCurrentUser({ id: "inv-1" });

      db.invoice.findFirst.mockResolvedValueOnce(
        invoiceRow({ status: "SENT", dueAt: new Date("2024-12-10T00:00:00.000Z") }) as never,
      );
      await getInvoiceForCurrentUser({ id: "inv-1" });

      expect(db.invoice.updateMany).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
