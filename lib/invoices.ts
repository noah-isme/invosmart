import { calculateTotals, type InvoiceItemInput } from "@/lib/invoice-utils";
import {
  InvoiceStatusEnum,
  parseInvoiceStatus,
  type InvoiceStatusValue,
} from "@/lib/schemas";
import type { PrismaClient } from "@prisma/client";

export type { InvoiceItemInput } from "@/lib/invoice-utils";

export type InvoiceForStatus = { status: unknown; dueAt: Date | null };

type InvoiceTimestampUpdate = {
  issuedAt?: Date;
  paidAt?: Date | null;
};

export const calculateInvoiceTotals = (
  items: InvoiceItemInput[],
  taxRate = 0.1,
) => {
  return calculateTotals(items, taxRate);
};

export const getStatusSideEffects = (
  previousStatus: InvoiceStatusValue,
  nextStatus: InvoiceStatusValue,
  now: Date = new Date(),
) => {
  const updates: InvoiceTimestampUpdate = {};

  if (nextStatus === InvoiceStatusEnum.enum.SENT && previousStatus !== InvoiceStatusEnum.enum.SENT) {
    updates.issuedAt = now;
  }

  if (nextStatus === InvoiceStatusEnum.enum.PAID) {
    updates.paidAt = now;
  } else if (previousStatus === InvoiceStatusEnum.enum.PAID) {
    updates.paidAt = null;
  }

  return updates;
};

export const isInvoiceOverdue = (invoice: InvoiceForStatus, now: Date = new Date()) => {
  if (!invoice.dueAt) {
    return false;
  }

  const status = parseInvoiceStatus(invoice.status);

  if (status === InvoiceStatusEnum.enum.PAID || status === InvoiceStatusEnum.enum.OVERDUE) {
    return status === InvoiceStatusEnum.enum.OVERDUE;
  }

  return invoice.dueAt.getTime() < now.getTime() &&
    (status === InvoiceStatusEnum.enum.SENT || status === InvoiceStatusEnum.enum.UNPAID);
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
      status: { in: [InvoiceStatusEnum.enum.SENT, InvoiceStatusEnum.enum.UNPAID] },
    },
    data: {
      status: InvoiceStatusEnum.enum.OVERDUE,
    },
  });
};
