import { z } from "zod";

import {
  ClientCreateSchema,
  InvoiceCreateSchema,
  InvoiceItemSchema,
  InvoiceStatusEnum,
} from "@/lib/schemas";

/** Public API accepts an omitted due date while retaining the shared invoice validation. */
export const ApiInvoiceCreateSchema = InvoiceCreateSchema.extend({
  dueAt: z.string().datetime().nullable().optional(),
});

export const ApiInvoicePatchSchema = z.object({
  client: z.string().trim().min(1).max(200).optional(),
  items: z.array(InvoiceItemSchema).min(1).optional(),
  taxRate: z.number().finite().min(0).max(1).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(200).nullable().optional(),
  clientId: z.string().nullable().optional(),
  currency: z.string().trim().min(1).max(12).optional(),
  status: InvoiceStatusEnum.optional(),
  issuedAt: z.string().datetime().optional(),
});

export const ApiClientCreateSchema = ClientCreateSchema;
export const ApiClientPatchSchema = ClientCreateSchema.partial();

export type ApiInvoiceCreateInput = z.infer<typeof ApiInvoiceCreateSchema>;
export type ApiInvoicePatchInput = z.infer<typeof ApiInvoicePatchSchema>;
export type ApiClientCreateInput = z.infer<typeof ApiClientCreateSchema>;
export type ApiClientPatchInput = z.infer<typeof ApiClientPatchSchema>;
