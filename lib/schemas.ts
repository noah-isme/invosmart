import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const emailField = z
  .string({ required_error: "Email wajib diisi." })
  .trim()
  .min(1, "Email wajib diisi.")
  .toLowerCase()
  .email("Format email tidak valid.");

export const LoginSchema = z.object({
  email: emailField,
  password: z
    .string({ required_error: "Password wajib diisi." })
    .min(6, "Password minimal 6 karakter."),
});

export const RegisterSchema = LoginSchema.extend({
  name: z
    .string({ required_error: "Nama wajib diisi." })
    .trim()
    .min(2, "Nama minimal 2 karakter."),
});

export type LoginSchemaInput = z.infer<typeof LoginSchema>;
export type RegisterSchemaInput = z.infer<typeof RegisterSchema>;

export const InvoiceItem = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});

export const InvoiceStatusEnum = z.enum([
  "DRAFT",
  "SENT",
  "PAID",
  "UNPAID",
  "OVERDUE",
]);

export const InvoiceCreate = z.object({
  client: z.string().min(1),
  items: z.array(InvoiceItem).min(1),
  tax: z.number().int().nonnegative().default(0),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  issuedAt: z.string().datetime().optional(),
});

export type InvoiceCreateInput = z.infer<typeof InvoiceCreate>;

export const InvoiceUpdateSchema = z.object({
  id: z.string(),
  client: z.string().min(1),
  items: z.array(InvoiceItem).min(1),
  subtotal: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  status: InvoiceStatusEnum,
  issuedAt: z.string(),
  dueAt: z.string().nullable(),
  notes: z.string().max(500).nullable().optional(),
});

export type InvoiceUpdateInput = z.infer<typeof InvoiceUpdateSchema>;

export const generateInvoiceNumber = async (db: PrismaClient) => {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.invoice.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
};
