import type { InvoiceStatusValue } from "@/lib/schemas";
import type { InvoiceItemInput } from "@/lib/invoice-utils";

export type InvoiceDetail = {
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
  emailedAt?: string | Date | null;
  notes: string | null;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
};
