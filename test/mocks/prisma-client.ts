import { vi } from "vitest";

class UserDelegate {
  findUnique = vi.fn();
  create = vi.fn();
  upsert = vi.fn();
  update = vi.fn();
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

export enum PolicyStatus {
  ALLOWED = "ALLOWED",
  REVIEW = "REVIEW",
  BLOCKED = "BLOCKED",
}

export enum OptimizationStatus {
  PENDING = "PENDING",
  APPLIED = "APPLIED",
  REJECTED = "REJECTED",
}

export enum ExperimentAxis {
  HOOK = "HOOK",
  CAPTION = "CAPTION",
  CTA = "CTA",
  SCHEDULE = "SCHEDULE",
}

export enum ExperimentStatus {
  running = "running",
  paused = "paused",
  stopped = "stopped",
  completed = "completed",
}

export enum AutoActionType {
  AUTOPUBLISH = "AUTOPUBLISH",
  SCHEDULE_UPDATE = "SCHEDULE_UPDATE",
  AUTO_REVERT = "AUTO_REVERT",
  AUTO_CTA_TUNE = "AUTO_CTA_TUNE",
}

export enum AutoActionStatus {
  applied = "applied",
  reverted = "reverted",
  failed = "failed",
}

export enum ReceiptPosition {
  bottom_left = "bottom_left",
  bottom_right = "bottom_right",
  center = "center",
}

class AuditLogDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  delete = vi.fn();
  deleteMany = vi.fn();
}

export class PrismaClient {
  user = new UserDelegate();
  invoice = new InvoiceDelegate();
  auditLog = new AuditLogDelegate();
}
