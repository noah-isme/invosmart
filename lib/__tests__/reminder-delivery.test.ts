import { describe, expect, it, vi } from "vitest";

import {
  MAX_REMINDER_DELIVERY_ATTEMPTS,
  claimReminderDelivery,
  createReminderDeliveryIdempotencyKey,
  dispatchReminderDeliveries,
  getNextReminderRetryAt,
  getReminderRetryDelayMs,
  normalizeReminderChannels,
  type ReminderDelivery,
  type ReminderDeliveryDb,
} from "@/lib/team/reminder-delivery";

const occurrence = {
  id: "occ-1",
  organizationId: "org-1",
  invoiceId: "inv-1",
  occurrenceKey: "reminder:v1:occurrence-1",
  scheduledAt: new Date("2026-08-14T08:00:00.000Z"),
  status: "PENDING",
  rule: { id: "rule-1", channels: ["EMAIL", "SLACK", "EMAIL"] },
  invoice: {
    id: "inv-1",
    number: "INV-001",
    client: "Acme",
    items: [],
    subtotal: 100,
    tax: 0,
    total: 100,
    currency: "IDR",
    status: "SENT",
    paidAt: null,
    dueAt: new Date("2026-08-20T08:00:00.000Z"),
    client_rel: { name: "Acme", email: "client@example.test" },
    user: { name: "Issuer" },
  },
};

const makeDb = (initialDeliveries: ReminderDelivery[] = []): ReminderDeliveryDb & {
  deliveries: ReminderDelivery[];
  occurrenceUpdates: Array<Record<string, unknown>>;
} => {
  const state = {
    deliveries: [...initialDeliveries],
    occurrenceUpdates: [] as Array<Record<string, unknown>>,
  };

  const db = {
    deliveries: state.deliveries,
    occurrenceUpdates: state.occurrenceUpdates,
    invoiceReminderOccurrence: {
      findMany: vi.fn().mockResolvedValue([occurrence]),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        state.occurrenceUpdates.push(data);
        return data;
      }),
    },
    invoiceReminderDelivery: {
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { occurrenceId: string } }) =>
        state.deliveries.filter((delivery) => delivery.occurrenceId === where.occurrenceId)),
      upsert: vi.fn().mockImplementation(async ({ create }: { create: ReminderDelivery }) => {
        const existing = state.deliveries.find(
          (delivery) => delivery.occurrenceId === create.occurrenceId && delivery.channel === create.channel,
        );
        if (existing) return existing;
        const created = { ...create, id: `${create.occurrenceId}-${create.channel}`, attempts: 0 };
        state.deliveries.push(created);
        return created;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const ids = where.id ? [where.id] : null;
        const statuses = (where.status as { in?: string[] } | string | undefined);
        const allowedStatuses = typeof statuses === "string"
          ? [statuses]
          : statuses?.in;
        let count = 0;
        for (const delivery of state.deliveries) {
          if (ids && !ids.includes(delivery.id)) continue;
          if (allowedStatuses && !allowedStatuses.includes(String(delivery.status))) continue;
          if (where.occurrenceId && delivery.occurrenceId !== where.occurrenceId) continue;
          const nextAttemptAt = delivery.nextAttemptAt ? new Date(delivery.nextAttemptAt).getTime() : null;
          const or = where.OR as Array<Record<string, unknown>> | undefined;
          if (or && !or.some((condition) =>
            ("nextAttemptAt" in condition && condition.nextAttemptAt === null && nextAttemptAt === null) ||
            ("nextAttemptAt" in condition && typeof condition.nextAttemptAt === "object" &&
              nextAttemptAt !== null && nextAttemptAt <= new Date((condition.nextAttemptAt as { lte: Date }).lte).getTime()))) {
            continue;
          }
          if (data.status) delivery.status = data.status as string;
          if (data.attempts && typeof data.attempts === "object") {
            delivery.attempts += Number((data.attempts as { increment: number }).increment);
          }
          for (const [key, value] of Object.entries(data)) {
            if (key === "status" || key === "attempts") continue;
            if (value === null || typeof value !== "object") {
              (delivery as unknown as Record<string, unknown>)[key] = value;
            }
          }
          count += 1;
        }
        return { count };
      }),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue({ status: "SENT", paidAt: null }),
    },
    workspaceNotificationEndpoint: {
      findFirst: vi.fn(),
    },
  } as unknown as ReminderDeliveryDb & {
    deliveries: ReminderDelivery[];
    occurrenceUpdates: Array<Record<string, unknown>>;
  };
  return db;
};

describe("reminder delivery state machine", () => {
  it("normalizes channels, idempotency keys, and bounded retry delays", () => {
    expect(normalizeReminderChannels(["email", "SLACK", "EMAIL", "unknown"])).toEqual(["EMAIL", "SLACK"]);
    expect(createReminderDeliveryIdempotencyKey("reminder:v1:key", "email")).toBe(
      "reminder-delivery:v1:reminder:v1:key:EMAIL",
    );
    expect(getReminderRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(getReminderRetryDelayMs(MAX_REMINDER_DELIVERY_ATTEMPTS)).toBeNull();
    expect(getNextReminderRetryAt(2, new Date("2026-08-14T08:00:00.000Z"))?.toISOString()).toBe(
      "2026-08-14T08:15:00.000Z",
    );
  });

  it("allows only one concurrent claim for a delivery", async () => {
    const db = makeDb([{
      id: "delivery-1",
      occurrenceId: "occ-1",
      channel: "EMAIL",
      status: "PENDING",
      attempts: 0,
    }]);
    const delivery = db.deliveries[0];
    const [first, second] = await Promise.all([
      claimReminderDelivery(delivery, { db, now: new Date("2026-08-14T08:00:00.000Z") }),
      claimReminderDelivery(delivery, { db, now: new Date("2026-08-14T08:00:00.000Z") }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(db.deliveries[0].attempts).toBe(1);
  });

  it("materializes both channels and sends each exactly once", async () => {
    const db = makeDb();
    const emailProvider = vi.fn().mockResolvedValue({ ok: true, providerRef: "re_email_1" });
    const slackProvider = vi.fn().mockResolvedValue({ ok: true, providerRef: "slack:1" });
    const result = await dispatchReminderDeliveries({
      db,
      now: new Date("2026-08-14T08:00:00.000Z"),
      providers: { EMAIL: emailProvider, SLACK: slackProvider },
    });

    expect(result).toMatchObject({ scanned: 1, materialized: 2, claimed: 2, sent: 2 });
    expect(emailProvider).toHaveBeenCalledTimes(1);
    expect(slackProvider).toHaveBeenCalledTimes(1);
    expect(db.deliveries.every((delivery) => delivery.status === "SENT")).toBe(true);
    expect(db.occurrenceUpdates.at(-1)).toMatchObject({ status: "SENT" });

    const replay = await dispatchReminderDeliveries({
      db,
      now: new Date("2026-08-14T08:01:00.000Z"),
      providers: { EMAIL: emailProvider, SLACK: slackProvider },
    });
    expect(replay.claimed).toBe(0);
    expect(emailProvider).toHaveBeenCalledTimes(1);
    expect(slackProvider).toHaveBeenCalledTimes(1);
  });

  it("skips missing recipients and suppresses paid invoices", async () => {
    const db = makeDb();
    const paidDb = makeDb();
    const paidOccurrence = { ...occurrence, invoice: { ...occurrence.invoice, status: "PAID", paidAt: new Date() } };
    paidDb.invoiceReminderOccurrence.findMany = vi.fn().mockResolvedValue([paidOccurrence]);
    paidDb.invoice!.findUnique = vi.fn().mockResolvedValue({ status: "PAID", paidAt: new Date() });
    const missing = {
      ...occurrence,
      rule: { ...occurrence.rule, channels: ["EMAIL"] },
      invoice: { ...occurrence.invoice, client_rel: { name: "Acme", email: null } },
    };
    db.invoiceReminderOccurrence.findMany = vi.fn().mockResolvedValue([missing]);
    const skipped = await dispatchReminderDeliveries({ db, now: new Date() });
    const suppressed = await dispatchReminderDeliveries({ db: paidDb, now: new Date() });

    expect(skipped.skipped).toBe(1);
    expect(suppressed.suppressed).toBeGreaterThan(0);
    expect(db.deliveries[0].errorCode).toBe("missing_recipient");
    expect(paidDb.deliveries[0].errorCode).toBe("paid_invoice");
  });
});
