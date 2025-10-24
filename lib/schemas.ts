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
    .min(2, "Nama minimal 2 karakter.")
    .max(200, "Nama maksimal 200 karakter."),
});

export type LoginSchemaInput = z.infer<typeof LoginSchema>;
export type RegisterSchemaInput = z.infer<typeof RegisterSchema>;

export const InvoiceItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Item name required")
    .max(200, "Item name must be 200 characters or less"),
  qty: z.number().int().positive("Quantity must be > 0"),
  price: z.number().int().nonnegative("Price must be >= 0"),
});

export const InvoiceFormSchema = z.object({
  client: z
    .string()
    .trim()
    .min(1, "Client name required")
    .max(200, "Client name must be 200 characters or less"),
  items: z.array(InvoiceItemSchema).min(1, "At least one item"),
  taxRate: z.number().default(0.1),
  dueAt: z.string().datetime().nullable(),
  notes: z
    .string()
    .trim()
    .max(200, "Notes must be 200 characters or less")
    .nullable()
    .optional(),
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
});

export type InvoiceCreateInput = z.infer<typeof InvoiceCreateSchema>;

export const InvoiceUpdateSchema = InvoiceFormSchema.extend({
  id: z.string(),
  subtotal: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  status: InvoiceStatusEnum,
  issuedAt: z.string(),
});

export type InvoiceUpdateInput = z.infer<typeof InvoiceUpdateSchema>;

export const InvoiceItem = InvoiceItemSchema;

export const AIInvoiceSchema = z.object({
  client: z
    .string()
    .trim()
    .min(1)
    .max(200),
  items: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(200),
        qty: z.number().positive(),
        price: z.number().nonnegative(),
      }),
    )
    .min(1),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(200).optional(),
});

export const generateInvoiceNumber = async (db: PrismaClient) => {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.invoice.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
};

export const BrandingSchema = z.object({
  logoUrl: z
    .union([
      z
        .string()
        .trim()
        .url("Logo URL harus berupa tautan valid.")
        .max(2048, "Logo URL maksimal 2048 karakter."),
      z.null(),
    ])
    .optional(),
  primaryColor: z
    .union([
      z
        .string()
        .trim()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Warna utama harus dalam format hex, misal #1E3A8A."),
      z.null(),
    ])
    .optional(),
  fontFamily: z.union([z.literal("sans"), z.literal("serif"), z.literal("mono"), z.null()]).optional(),
});

export type BrandingInput = z.infer<typeof BrandingSchema>;
