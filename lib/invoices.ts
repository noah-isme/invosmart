import { InvoiceStatus, type Invoice, type PrismaClient } from "@prisma/client";
import type { z } from "zod";

import { InvoiceItem } from "@/lib/schemas";

export type InvoiceItemInput = z.infer<typeof InvoiceItem>;

export type InvoiceForStatus = Pick<Invoice, "status" | "dueAt">;

export const calculateInvoiceTotals = (items: InvoiceItemInput[], tax = 0) => {
  const subtotal = items.reduce((acc, item) => acc + item.qty * item.price, 0);
  const normalizedTax = Math.max(0, Math.trunc(tax));
  const total = subtotal + normalizedTax;

  return { subtotal, total, tax: normalizedTax };
};

export const getStatusSideEffects = (
  previousStatus: InvoiceStatus,
  nextStatus: InvoiceStatus,
  now: Date = new Date(),
) => {
  const updates: Partial<Pick<Invoice, "issuedAt" | "paidAt">> = {};

  if (nextStatus === InvoiceStatus.SENT && previousStatus !== InvoiceStatus.SENT) {
    updates.issuedAt = now;
  }

  if (nextStatus === InvoiceStatus.PAID) {
    updates.paidAt = now;
  } else if (previousStatus === InvoiceStatus.PAID) {
    updates.paidAt = null;
  }

  return updates;
};

export const isInvoiceOverdue = (invoice: InvoiceForStatus, now: Date = new Date()) => {
  if (!invoice.dueAt) {
    return false;
  }

  if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.OVERDUE) {
    return invoice.status === InvoiceStatus.OVERDUE;
  }

  return invoice.dueAt.getTime() < now.getTime() &&
    (invoice.status === InvoiceStatus.SENT || invoice.status === InvoiceStatus.UNPAID);
};

export const markUserOverdueInvoices = async (
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
) => {
  return db.invoice.updateMany({
    where: {
      userId,
      dueAt: { lt: now },
      status: { in: [InvoiceStatus.SENT, InvoiceStatus.UNPAID] },
    },
    data: {
      status: InvoiceStatus.OVERDUE,
    },
  });
};
