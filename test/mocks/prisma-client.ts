import { vi } from "vitest";

class UserDelegate {
  findUnique = vi.fn();
  create = vi.fn();
  upsert = vi.fn();
}

class InvoiceDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  updateMany = vi.fn();
  delete = vi.fn();
  aggregate = vi.fn();
}

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  SENT = "SENT",
  PAID = "PAID",
  UNPAID = "UNPAID",
  OVERDUE = "OVERDUE",
}

export class PrismaClient {
  user = new UserDelegate();
  invoice = new InvoiceDelegate();
}
