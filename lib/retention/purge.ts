import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

/**
 * Data retention purge (SECURITY.md "Retention and deletion"), run daily by
 * /api/cron/retention.
 *
 * Steps, each capped at maxBatches x batchSize rows per run:
 *   (a) delete AuditLog rows older than auditLogDays;
 *   (b) null AuditLog.ipAddress older than ipDays (rows are kept);
 *   (c) delete InvoiceReminderOccurrence rows in a terminal state
 *       (SENT/FAILED/SKIPPED) scheduled more than reminderDays ago; their
 *       InvoiceReminderDelivery rows go with them (FK cascade).
 *
 * Only AuditLog and InvoiceReminderOccurrence are touched. Financial records
 * (payments, attempts, provider events, invoices, receipts) are kept
 * indefinitely, and the unique provider event ids are what keep webhook
 * replays idempotent; this module must never reference them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const TERMINAL_REMINDER_OCCURRENCE_STATUSES = ["SENT", "FAILED", "SKIPPED"] as const;

export type RetentionConfig = {
  auditLogDays: number;
  ipDays: number;
  reminderDays: number;
  batchSize: number;
  maxBatches: number;
};

export type RetentionPurgeResult = {
  dryRun: boolean;
  auditLogsDeleted: number;
  ipAddressesCleared: number;
  reminderOccurrencesDeleted: number;
  batches: number;
  truncated: boolean;
};

export type RetentionPurgeStep = "auditLogs" | "ipAddresses" | "reminderOccurrences";

/**
 * A real run that failed part-way. `partial` holds what the completed batches
 * already deleted or cleared (those writes are committed), so the caller can
 * report and audit them.
 */
export class RetentionPurgeError extends Error {
  readonly partial: RetentionPurgeResult;
  readonly failedStep: RetentionPurgeStep;

  constructor(partial: RetentionPurgeResult, failedStep: RetentionPurgeStep, cause: unknown) {
    super(`Retention purge failed during ${failedStep}`, { cause });
    this.name = "RetentionPurgeError";
    this.partial = partial;
    this.failedStep = failedStep;
  }
}

export class RetentionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionConfigError";
  }
}

// Blank values fall back to the default instead of coercing to 0.
const positiveInt = (fallback: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(1).default(fallback),
  );

const retentionEnvSchema = z
  .object({
    RETENTION_AUDIT_LOG_DAYS: positiveInt(365),
    RETENTION_IP_DAYS: positiveInt(90),
    RETENTION_REMINDER_DAYS: positiveInt(365),
    RETENTION_BATCH_SIZE: positiveInt(1000),
    RETENTION_MAX_BATCHES: positiveInt(20),
  })
  .refine((env) => env.RETENTION_IP_DAYS <= env.RETENTION_AUDIT_LOG_DAYS, {
    message:
      "RETENTION_IP_DAYS must not exceed RETENTION_AUDIT_LOG_DAYS (the IP cutoff must be the shorter one)",
    path: ["RETENTION_IP_DAYS"],
  });

/**
 * Reads the retention periods and batch caps from the environment. Throws a
 * RetentionConfigError (purging nothing) for values below 1, non-integers, or
 * an IP period longer than the audit-log period.
 */
export const readRetentionConfig = (env: NodeJS.ProcessEnv = process.env): RetentionConfig => {
  const parsed = retentionEnvSchema.safeParse({
    RETENTION_AUDIT_LOG_DAYS: env.RETENTION_AUDIT_LOG_DAYS,
    RETENTION_IP_DAYS: env.RETENTION_IP_DAYS,
    RETENTION_REMINDER_DAYS: env.RETENTION_REMINDER_DAYS,
    RETENTION_BATCH_SIZE: env.RETENTION_BATCH_SIZE,
    RETENTION_MAX_BATCHES: env.RETENTION_MAX_BATCHES,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) =>
        issue.code === "custom" ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
      )
      .join("; ");
    throw new RetentionConfigError(`Invalid retention configuration: ${issues}`);
  }
  return {
    auditLogDays: parsed.data.RETENTION_AUDIT_LOG_DAYS,
    ipDays: parsed.data.RETENTION_IP_DAYS,
    reminderDays: parsed.data.RETENTION_REMINDER_DAYS,
    batchSize: parsed.data.RETENTION_BATCH_SIZE,
    maxBatches: parsed.data.RETENTION_MAX_BATCHES,
  };
};

export type RetentionDb = Pick<PrismaClient, "auditLog" | "invoiceReminderOccurrence">;

export type RunRetentionPurgeInput = {
  now: Date;
  dryRun: boolean;
  config: RetentionConfig;
  db: RetentionDb;
};

type StepOutcome = { affected: number; batches: number; truncated: boolean };

const emptyOutcome = (): StepOutcome => ({ affected: 0, batches: 0, truncated: false });

export const retentionCutoffs = (now: Date, config: RetentionConfig) => ({
  auditLog: new Date(now.getTime() - config.auditLogDays * DAY_MS),
  ip: new Date(now.getTime() - config.ipDays * DAY_MS),
  reminder: new Date(now.getTime() - config.reminderDays * DAY_MS),
});

/**
 * Select-then-delete in id batches. The deleted rows no longer match `where`,
 * so each batch reads the next oldest rows. Progress is written to `outcome`
 * after every batch, so it is still accurate when a later batch throws.
 */
const deleteInBatches = async (
  config: RetentionConfig,
  outcome: StepOutcome,
  select: () => Promise<Array<{ id: string }>>,
  remove: (ids: string[]) => Promise<{ count: number }>,
): Promise<void> => {
  let lastBatchFull = false;
  while (outcome.batches < config.maxBatches) {
    const rows = await select();
    if (rows.length === 0) {
      lastBatchFull = false;
      break;
    }
    const { count } = await remove(rows.map((row) => row.id));
    outcome.affected += count;
    outcome.batches += 1;
    lastBatchFull = rows.length === config.batchSize;
    if (!lastBatchFull) break;
  }
  outcome.truncated = outcome.batches === config.maxBatches && lastBatchFull;
};

export const runRetentionPurge = async ({
  now,
  dryRun,
  config,
  db,
}: RunRetentionPurgeInput): Promise<RetentionPurgeResult> => {
  const cutoffs = retentionCutoffs(now, config);

  const auditLogWhere: Prisma.AuditLogWhereInput = { createdAt: { lt: cutoffs.auditLog } };
  // Rows older than the audit-log cutoff are deleted by step (a); skip them here.
  const ipWhere = (after?: Date): Prisma.AuditLogWhereInput => ({
    createdAt: { lt: cutoffs.ip, gte: cutoffs.auditLog, ...(after ? { gt: after } : {}) },
    ipAddress: { not: null },
  });
  const reminderWhere: Prisma.InvoiceReminderOccurrenceWhereInput = {
    scheduledAt: { lt: cutoffs.reminder },
    status: { in: [...TERMINAL_REMINDER_OCCURRENCE_STATUSES] },
  };

  if (dryRun) {
    const [auditLogsDeleted, ipAddressesCleared, reminderOccurrencesDeleted] = await Promise.all([
      db.auditLog.count({ where: auditLogWhere }),
      db.auditLog.count({ where: ipWhere() }),
      db.invoiceReminderOccurrence.count({ where: reminderWhere }),
    ]);
    return {
      dryRun: true,
      auditLogsDeleted,
      ipAddressesCleared,
      reminderOccurrencesDeleted,
      batches: 0,
      truncated: false,
    };
  }

  const auditLogs = emptyOutcome();
  const ip = emptyOutcome();
  const reminders = emptyOutcome();
  const result = (): RetentionPurgeResult => ({
    dryRun: false,
    auditLogsDeleted: auditLogs.affected,
    ipAddressesCleared: ip.affected,
    reminderOccurrencesDeleted: reminders.affected,
    batches: auditLogs.batches + ip.batches + reminders.batches,
    truncated: auditLogs.truncated || ip.truncated || reminders.truncated,
  });

  let step: RetentionPurgeStep = "auditLogs";
  try {
    // (a) AuditLog rows past the audit-log period.
    await deleteInBatches(
      config,
      auditLogs,
      () =>
        db.auditLog.findMany({
          where: auditLogWhere,
          select: { id: true },
          take: config.batchSize,
          orderBy: { createdAt: "asc" },
        }),
      (ids) => db.auditLog.deleteMany({ where: { id: { in: ids } } }),
    );

    // (b) IP addresses past the IP period. Keyset cursor on createdAt: each
    // batch starts after the last row of the previous one, so the loop always
    // moves forward and terminates. Rows sharing the boundary timestamp are
    // picked up by the next run.
    step = "ipAddresses";
    let ipLastBatchFull = false;
    let lastSeenCreatedAt: Date | undefined;
    while (ip.batches < config.maxBatches) {
      const rows = await db.auditLog.findMany({
        where: ipWhere(lastSeenCreatedAt),
        select: { id: true, createdAt: true },
        take: config.batchSize,
        orderBy: { createdAt: "asc" },
      });
      if (rows.length === 0) {
        ipLastBatchFull = false;
        break;
      }
      const { count } = await db.auditLog.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { ipAddress: null },
      });
      ip.affected += count;
      ip.batches += 1;
      lastSeenCreatedAt = rows[rows.length - 1].createdAt;
      ipLastBatchFull = rows.length === config.batchSize;
      if (!ipLastBatchFull) break;
    }
    ip.truncated = ip.batches === config.maxBatches && ipLastBatchFull;

    // (c) Terminal reminder occurrences; deliveries cascade.
    step = "reminderOccurrences";
    await deleteInBatches(
      config,
      reminders,
      () =>
        db.invoiceReminderOccurrence.findMany({
          where: reminderWhere,
          select: { id: true },
          take: config.batchSize,
          orderBy: { createdAt: "asc" },
        }),
      (ids) => db.invoiceReminderOccurrence.deleteMany({ where: { id: { in: ids } } }),
    );
  } catch (error) {
    throw new RetentionPurgeError(result(), step, error);
  }

  return result();
};
