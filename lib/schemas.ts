import { z } from "zod";

export const InvoiceItem = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});

export const InvoiceCreate = z.object({
  client: z.string().min(1),
  items: z.array(InvoiceItem).min(1),
  issuedAt: z.string().datetime().optional(),
});

export type InvoiceCreate = z.infer<typeof InvoiceCreate>;
