import type { InvoiceStatusValue } from "@/lib/schemas";
import type { InvoiceItemInput } from "@/lib/invoices";

export type DashboardInvoice = {
  id: string;
  number: string;
  client: string;
  items: InvoiceItemInput[];
  subtotal: number;
  tax: number;
  total: number;
  status: InvoiceStatusValue;
  issuedAt: string;
  dueAt: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type InvoiceDashboardStats = {
  revenue: number;
  unpaid: number;
  overdue: number;
};

export type InvoiceFilterValue = InvoiceStatusValue | "ALL";

export type InvoiceFilterCounts = Record<InvoiceFilterValue, number>;
