import { vi } from "vitest";

class UserDelegate {
  findUnique = vi.fn();
  create = vi.fn();
  upsert = vi.fn();
  update = vi.fn();
}

class OrganizationDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  delete = vi.fn();
}

class MembershipDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  delete = vi.fn();
}

class ApiKeyDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  delete = vi.fn();
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
  groupBy = vi.fn();
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

export enum WorkspaceRole {
  OWNER = "OWNER",
  ADMIN = "ADMIN",
  MEMBER = "MEMBER",
  VIEWER = "VIEWER",
}

class ClientDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  delete = vi.fn();
}

class InvoiceTemplateDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  delete = vi.fn();
  deleteMany = vi.fn();
}

class FeatureFlagDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  update = vi.fn();
  upsert = vi.fn();
  delete = vi.fn();
}

class UptimeCheckDelegate {
  count = vi.fn();
  create = vi.fn();
  findMany = vi.fn();
  findFirst = vi.fn();
  findUnique = vi.fn();
  delete = vi.fn();
  deleteMany = vi.fn();
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
  organization = new OrganizationDelegate();
  membership = new MembershipDelegate();
  apiKey = new ApiKeyDelegate();
  invoice = new InvoiceDelegate();
  auditLog = new AuditLogDelegate();
  client = new ClientDelegate();
  invoiceTemplate = new InvoiceTemplateDelegate();
  featureFlag = new FeatureFlagDelegate();
  uptimeCheck = new UptimeCheckDelegate();
}
