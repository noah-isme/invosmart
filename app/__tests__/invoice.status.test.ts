import { InvoiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { calculateTotals } from "@/lib/invoice-utils";
import {
  getStatusSideEffects,
  isInvoiceOverdue,
  markUserOverdueInvoices,
} from "@/lib/invoices";

describe("Invoice utilities", () => {
  it("menghitung subtotal dan total berdasarkan item", () => {
    const totals = calculateTotals([
      { name: "Design", qty: 2, price: 400_000 },
      { name: "Development", qty: 1, price: 1_200_000 },
    ]);

    expect(totals.subtotal).toBe(2_000_000);
    expect(totals.tax).toBe(200_000);
    expect(totals.total).toBe(2_200_000);
  });

  it("menetapkan issuedAt dan paidAt sesuai transisi status", () => {
    const now = new Date("2024-11-10T00:00:00.000Z");
    const sideEffects = getStatusSideEffects(InvoiceStatus.DRAFT, InvoiceStatus.SENT, now);

    expect(sideEffects.issuedAt).toEqual(now);

    const paidEffects = getStatusSideEffects(InvoiceStatus.SENT, InvoiceStatus.PAID, now);
    expect(paidEffects.paidAt).toEqual(now);

    const revertEffects = getStatusSideEffects(InvoiceStatus.PAID, InvoiceStatus.UNPAID, now);
    expect(revertEffects.paidAt).toBeNull();
  });

  it("menandai invoice overdue jika jatuh tempo terlewati dan belum dibayar", () => {
    const now = new Date("2024-11-15T00:00:00.000Z");
    const overdue = isInvoiceOverdue(
      { status: InvoiceStatus.UNPAID, dueAt: new Date("2024-11-10T00:00:00.000Z") },
      now,
    );

    expect(overdue).toBe(true);

    const paid = isInvoiceOverdue(
      { status: InvoiceStatus.PAID, dueAt: new Date("2024-11-10T00:00:00.000Z") },
      now,
    );

    expect(paid).toBe(false);
  });

  it("memperbarui invoice user yang sudah lewat tempo", async () => {
  // Create a small mocked client shape to satisfy typing without pulling
  // in heavy runtime behaviour.
  const db = {
    invoice: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as const;

    const now = new Date("2024-11-20T00:00:00.000Z");

    await markUserOverdueInvoices(db, "user-1", now);

    expect(db.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        dueAt: { lt: now },
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.UNPAID] },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
  });
});
