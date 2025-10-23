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

export const InvoiceItemSchema = z.object({
  name: z.string().min(1, "Item name required"),
  qty: z.number().int().positive("Quantity must be > 0"),
  price: z.number().int().nonnegative("Price must be >= 0"),
});

export const InvoiceFormSchema = z.object({
  client: z.string().min(1, "Client name required"),
  items: z.array(InvoiceItemSchema).min(1, "At least one item"),
  taxRate: z.number().default(0.1),
  dueAt: z.string().datetime().nullable(),
});

export type InvoiceForm = z.infer<typeof InvoiceFormSchema>;

export const InvoiceStatusEnum = z.enum([
  "DRAFT",
  "SENT",
  "PAID",
  "UNPAID",
  "OVERDUE",
]);

export type InvoiceStatusValue = z.infer<typeof InvoiceStatusEnum>;
export const invoiceStatusValues = InvoiceStatusEnum.options;

export const InvoiceCreateSchema = InvoiceFormSchema.extend({
  status: InvoiceStatusEnum.default("DRAFT"),
  notes: z.string().max(500).nullable().optional(),
});

export type InvoiceCreateInput = z.infer<typeof InvoiceCreateSchema>;

export const InvoiceUpdateSchema = InvoiceFormSchema.extend({
  id: z.string(),
  subtotal: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  status: InvoiceStatusEnum,
  issuedAt: z.string(),
  notes: z.string().max(500).nullable().optional(),
});

export type InvoiceUpdateInput = z.infer<typeof InvoiceUpdateSchema>;

export const InvoiceItem = InvoiceItemSchema;

export const generateInvoiceNumber = async (db: PrismaClient) => {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.invoice.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
};
