import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  RetentionConfigError,
  RetentionPurgeError,
  readRetentionConfig,
  runRetentionPurge,
  type RetentionConfig,
  type RetentionDb,
} from "@/lib/retention/purge";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-16T03:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

const config = (overrides: Partial<RetentionConfig> = {}): RetentionConfig => ({
  auditLogDays: 365,
  ipDays: 90,
  reminderDays: 365,
  batchSize: 2,
  maxBatches: 3,
  ...overrides,
});

type Row = { id: string; createdAt: Date };

/**
 * A db stand-in whose findMany returns the given pages in order (then []),
 * recording every model the purge touches through a Proxy.
 */
const fakeDb = (pages: { audit?: Row[][]; ip?: Row[][]; reminder?: Row[][] } = {}) => {
  const touched = new Set<string>();
  const auditPages = [...(pages.audit ?? [])];
  const ipPages = [...(pages.ip ?? [])];
  const reminderPages = [...(pages.reminder ?? [])];

  const auditLog = {
    count: vi.fn().mockResolvedValue(7),
    findMany: vi.fn(async (args: { where: { ipAddress?: unknown } }) =>
      (args.where.ipAddress ? ipPages.shift() : auditPages.shift()) ?? [],
    ),
    deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length })),
    updateMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length })),
  };
  const invoiceReminderOccurrence = {
    count: vi.fn().mockResolvedValue(3),
    findMany: vi.fn(async () => reminderPages.shift() ?? []),
    deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length })),
  };
  const models: Record<string, unknown> = { auditLog, invoiceReminderOccurrence };
  const db = new Proxy(models, {
    get(target, prop: string) {
      touched.add(prop);
      return target[prop];
    },
  }) as unknown as RetentionDb;
  return { db, auditLog, invoiceReminderOccurrence, touched };
};

const rows = (prefix: string, count: number, start = daysAgo(400)) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    createdAt: new Date(start.getTime() + i * 1000),
  }));

describe("readRetentionConfig", () => {
  it("uses the defaults when nothing (or blanks) is set", () => {
    expect(readRetentionConfig({})).toEqual({
      auditLogDays: 365,
      ipDays: 90,
      reminderDays: 365,
      batchSize: 1000,
      maxBatches: 20,
    });
    expect(readRetentionConfig({ RETENTION_IP_DAYS: " ", RETENTION_BATCH_SIZE: "" }).ipDays).toBe(90);
  });

  it("coerces numeric strings", () => {
    expect(
      readRetentionConfig({
        RETENTION_AUDIT_LOG_DAYS: "400",
        RETENTION_IP_DAYS: "30",
        RETENTION_REMINDER_DAYS: "180",
        RETENTION_BATCH_SIZE: "50",
        RETENTION_MAX_BATCHES: "5",
      }),
    ).toEqual({ auditLogDays: 400, ipDays: 30, reminderDays: 180, batchSize: 50, maxBatches: 5 });
  });

  it.each([
    ["RETENTION_AUDIT_LOG_DAYS", "0"],
    ["RETENTION_IP_DAYS", "-5"],
    ["RETENTION_BATCH_SIZE", "abc"],
    ["RETENTION_MAX_BATCHES", "1.5"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => readRetentionConfig({ [name]: value })).toThrow(RetentionConfigError);
  });

  it("rejects RETENTION_IP_DAYS=400 with RETENTION_AUDIT_LOG_DAYS=365", () => {
    expect(() => readRetentionConfig({ RETENTION_IP_DAYS: "400", RETENTION_AUDIT_LOG_DAYS: "365" })).toThrow(
      /RETENTION_IP_DAYS must not exceed RETENTION_AUDIT_LOG_DAYS/,
    );
  });
});

describe("runRetentionPurge", () => {
  it("dry run only counts, with the right cutoffs, and writes nothing", async () => {
    const { db, auditLog, invoiceReminderOccurrence } = fakeDb();

    const result = await runRetentionPurge({ now: NOW, dryRun: true, config: config(), db });

    expect(result).toEqual({
      dryRun: true,
      auditLogsDeleted: 7,
      ipAddressesCleared: 7,
      reminderOccurrencesDeleted: 3,
      batches: 0,
      truncated: false,
    });
    expect(auditLog.count).toHaveBeenCalledWith({ where: { createdAt: { lt: daysAgo(365) } } });
    expect(auditLog.count).toHaveBeenCalledWith({
      where: { createdAt: { lt: daysAgo(90), gte: daysAgo(365) }, ipAddress: { not: null } },
    });
    expect(invoiceReminderOccurrence.count).toHaveBeenCalledWith({
      where: { scheduledAt: { lt: daysAgo(365) }, status: { in: ["SENT", "FAILED", "SKIPPED"] } },
    });
    for (const write of [auditLog.deleteMany, auditLog.updateMany, invoiceReminderOccurrence.deleteMany]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(auditLog.findMany).not.toHaveBeenCalled();
  });

  it("deletes, nulls and purges in id batches with the configured cutoffs", async () => {
    const { db, auditLog, invoiceReminderOccurrence } = fakeDb({
      audit: [rows("a", 2), rows("b", 1)],
      ip: [rows("ip", 1, daysAgo(200))],
      reminder: [rows("r", 1)],
    });

    const result = await runRetentionPurge({ now: NOW, dryRun: false, config: config(), db });

    expect(result).toEqual({
      dryRun: false,
      auditLogsDeleted: 3,
      ipAddressesCleared: 1,
      reminderOccurrencesDeleted: 1,
      batches: 4,
      truncated: false,
    });
    expect(auditLog.findMany).toHaveBeenNthCalledWith(1, {
      where: { createdAt: { lt: daysAgo(365) } },
      select: { id: true },
      take: 2,
      orderBy: { createdAt: "asc" },
    });
    expect(auditLog.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: { in: ["a-0", "a-1"] } } });
    expect(auditLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["ip-0"] } },
      data: { ipAddress: null },
    });
    expect(invoiceReminderOccurrence.findMany).toHaveBeenCalledWith({
      where: { scheduledAt: { lt: daysAgo(365) }, status: { in: ["SENT", "FAILED", "SKIPPED"] } },
      select: { id: true },
      take: 2,
      orderBy: { createdAt: "asc" },
    });
    expect(invoiceReminderOccurrence.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["r-0"] } } });
  });

  it("advances the IP keyset cursor past the last row of each batch", async () => {
    const first = rows("ip1", 2, daysAgo(300));
    const { db, auditLog } = fakeDb({ ip: [first, rows("ip2", 1, daysAgo(200))] });

    await runRetentionPurge({ now: NOW, dryRun: false, config: config(), db });

    const ipCalls = auditLog.findMany.mock.calls
      .map(([args]) => args as { where: { createdAt: Record<string, Date>; ipAddress?: unknown } })
      .filter((args) => args.where.ipAddress);
    expect(ipCalls).toHaveLength(2);
    expect(ipCalls[0].where.createdAt).toEqual({ lt: daysAgo(90), gte: daysAgo(365) });
    expect(ipCalls[1].where.createdAt).toEqual({ lt: daysAgo(90), gte: daysAgo(365), gt: first[1].createdAt });
  });

  it("stops at maxBatches and reports truncated", async () => {
    const { db, auditLog } = fakeDb({ audit: [rows("a", 2), rows("b", 2), rows("c", 2), rows("d", 2)] });

    const result = await runRetentionPurge({ now: NOW, dryRun: false, config: config({ maxBatches: 3 }), db });

    expect(auditLog.deleteMany).toHaveBeenCalledTimes(3);
    expect(result.auditLogsDeleted).toBe(6);
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when the last batch is short", async () => {
    const { db } = fakeDb({ audit: [rows("a", 2), rows("b", 2), rows("c", 1)] });

    const result = await runRetentionPurge({ now: NOW, dryRun: false, config: config({ maxBatches: 3 }), db });

    expect(result.truncated).toBe(false);
  });

  it("reports what committed batches already did when a later step fails", async () => {
    const { db, auditLog, invoiceReminderOccurrence } = fakeDb({
      audit: [rows("a", 2), rows("b", 1)],
      ip: [rows("ip", 1, daysAgo(200))],
      reminder: [rows("r", 2), rows("s", 2)],
    });
    // The second reminder batch fails after the first one committed.
    invoiceReminderOccurrence.deleteMany
      .mockImplementationOnce(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length }))
      .mockRejectedValueOnce(new Error("connection reset"));

    const error = await runRetentionPurge({ now: NOW, dryRun: false, config: config(), db }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RetentionPurgeError);
    const failure = error as RetentionPurgeError;
    expect(failure.failedStep).toBe("reminderOccurrences");
    expect((failure.cause as Error).message).toBe("connection reset");
    expect(failure.message).not.toContain("connection reset");
    expect(failure.partial).toEqual({
      dryRun: false,
      auditLogsDeleted: 3,
      ipAddressesCleared: 1,
      reminderOccurrencesDeleted: 2,
      batches: 4,
      truncated: false,
    });
    expect(auditLog.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("names the step that failed first, with nothing counted after it", async () => {
    const { db, auditLog } = fakeDb({ audit: [rows("a", 1)], ip: [rows("ip", 1, daysAgo(200))] });
    auditLog.updateMany.mockRejectedValueOnce(new Error("boom"));

    const error = (await runRetentionPurge({ now: NOW, dryRun: false, config: config(), db }).catch(
      (e: unknown) => e,
    )) as RetentionPurgeError;

    expect(error.failedStep).toBe("ipAddresses");
    expect(error.partial).toMatchObject({ auditLogsDeleted: 1, ipAddressesCleared: 0, reminderOccurrencesDeleted: 0 });
  });

  it("touches only AuditLog and InvoiceReminderOccurrence", async () => {
    const { db, touched } = fakeDb({ audit: [rows("a", 1)], ip: [rows("ip", 1)], reminder: [rows("r", 1)] });

    await runRetentionPurge({ now: NOW, dryRun: false, config: config(), db });
    await runRetentionPurge({ now: NOW, dryRun: true, config: config(), db });

    expect([...touched].sort()).toEqual(["auditLog", "invoiceReminderOccurrence"]);
  });

  it("never references a payment, invoice or receipt model in its source", () => {
    const source = readFileSync(path.resolve(__dirname, "../retention/purge.ts"), "utf8");
    for (const model of ["payment", "paymentAttempt", "paymentEvent", "invoice", "receipt", "receiptAuditLog"]) {
      expect(source).not.toMatch(new RegExp(`\\b(db|tx)\\.${model}\\b`));
      expect(source).not.toMatch(new RegExp(`\\b${model}\\s*\\.\\s*(findMany|deleteMany|updateMany|delete|update|count)\\b`, "i"));
    }
  });
});
