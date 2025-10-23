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

export const InvoiceCreate = z.object({
  client: z.string().min(1),
  items: z.array(InvoiceItem).min(1),
  issuedAt: z.string().datetime().optional(),
});

export type InvoiceCreate = z.infer<typeof InvoiceCreate>;
