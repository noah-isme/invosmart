import type { z } from "zod";

import { InvoiceItemSchema } from "@/lib/schemas";

export type InvoiceItemInput = z.infer<typeof InvoiceItemSchema>;

export const calculateTotals = (
  items: InvoiceItemInput[],
  taxRate = 0.1,
) => {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;
  return { subtotal, tax, total };
};
