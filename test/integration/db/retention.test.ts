// RET-INT-01: /api/cron/retention deletes AuditLog rows older than 12 months,
// nulls IP addresses older than 90 days (rows kept; a second run finds nothing
// left, so the keyset cursor terminates), deletes terminal reminder
// occurrences older than 12 months with their deliveries, leaves pending
// occurrences and every payment row alone, and writes one RETENTION_PURGE
// audit row; a run that fails part-way answers 500 with the partial counts
// and still writes the audit row (failed:true). RET-INT-02: dry run changes nothing. RET-INT-03: without
// RETENTION_ENABLED the cron skips. RET-INT-04: a held CronLease skips.
// @covers: /api/cron/retention (route handler called in-process; scripts/e2e-coverage-check.mjs)
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as retentionCron } from "@/app/api/cron/retention/route";
import { E2E_SECRETS } from "../../e2e/playwright.env";

import { DAY_MS, createInvoice, createUserWithWorkspace, db, request, uid } from "./harness/fixtures";

const ENV_KEYS = ["RETENTION_ENABLED", "RETENTION_DRY_RUN", "RETENTION_IP_DAYS", "RETENTION_AUDIT_LOG_DAYS"] as const;
const previousEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const cron = (query = "") =>
  retentionCron(
    request(`/api/cron/retention${query}`, {
      headers: { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` },
    }),
  );

const ago = (days: number) => new Date(Date.now() - days * DAY_MS);

type Seed = Awaited<ReturnType<typeof seed>>;

/** Old and recent rows of every kind, all tagged with a unique marker. */
async function seed() {
  const marker = `ret-${uid()}`;
  const { user, organization } = await createUserWithWorkspace();
  const audit = (days: number, ip: string | null) =>
    db.auditLog.create({
      data: {
        tenantId: organization.id,
        userId: user.id,
        action: "RET_TEST",
        entity: marker,
        ipAddress: ip,
        createdAt: ago(days),
      },
    });
  const oldAudit = await audit(400, "198.51.100.1");
  const midAudit = await audit(200, "198.51.100.2");
  const recentAudit = await audit(10, "198.51.100.3");

  const invoice = await createInvoice({ userId: user.id, organizationId: organization.id, status: "SENT" });
  const rule = await db.invoiceReminderRule.create({
    data: { organizationId: organization.id, name: `rule ${marker}`, offsetDays: -3, channels: ["EMAIL"] },
  });
  const occurrence = (key: string, days: number, status: string, deliveryStatus: "SENT" | "PENDING") =>
    db.invoiceReminderOccurrence.create({
      data: {
        organizationId: organization.id,
        invoiceId: invoice.id,
        ruleId: rule.id,
        occurrenceKey: `${marker}-${key}`,
        scheduledAt: ago(days),
        status,
        deliveries: { create: { channel: "EMAIL", status: deliveryStatus } },
      },
      include: { deliveries: true },
    });
  const oldSent = await occurrence("old-sent", 400, "SENT", "SENT");
  const oldFailed = await occurrence("old-failed", 400, "FAILED", "SENT");
  const oldPending = await occurrence("old-pending", 400, "PENDING", "PENDING");
  const recentSent = await occurrence("recent-sent", 10, "SENT", "SENT");

  // Financial rows older than every cutoff: never purged.
  const attempt = await db.paymentAttempt.create({
    data: {
      invoiceId: invoice.id,
      provider: "stripe",
      idempotencyKey: `${marker}-attempt`,
      amount: 150_000,
      currency: "IDR",
      status: "SETTLED",
      createdAt: ago(800),
    },
  });
  const paymentEvent = await db.paymentEvent.create({
    data: {
      attemptId: attempt.id,
      provider: "stripe",
      providerEventId: `${marker}-evt`,
      eventType: "SETTLED",
      status: "SETTLED",
      createdAt: ago(800),
    },
  });
  const payment = await db.payment.create({
    data: { invoiceId: invoice.id, attemptId: attempt.id, paidAmount: 150_000, paidAt: ago(800), createdAt: ago(800) },
  });

  return {
    marker,
    invoice,
    audits: { oldAudit, midAudit, recentAudit },
    occurrences: { oldSent, oldFailed, oldPending, recentSent },
    payments: { attempt, paymentEvent, payment },
  };
}

const snapshot = async (s: Seed) => ({
  audits: await db.auditLog.findMany({ where: { entity: s.marker }, orderBy: { createdAt: "asc" } }),
  occurrences: await db.invoiceReminderOccurrence.findMany({
    where: { occurrenceKey: { startsWith: s.marker } },
    orderBy: { occurrenceKey: "asc" },
  }),
  deliveries: await db.invoiceReminderDelivery.findMany({
    where: { occurrence: { occurrenceKey: { startsWith: s.marker } } },
    orderBy: { id: "asc" },
  }),
  invoice: await db.invoice.findUnique({ where: { id: s.invoice.id } }),
  attempt: await db.paymentAttempt.findUnique({ where: { id: s.payments.attempt.id } }),
  paymentEvent: await db.paymentEvent.findUnique({ where: { id: s.payments.paymentEvent.id } }),
  payment: await db.payment.findUnique({ where: { id: s.payments.payment.id } }),
});

const purgeAuditRows = () => db.auditLog.count({ where: { action: "RETENTION_PURGE" } });

beforeAll(async () => {
  await db.cronLease.deleteMany({ where: { name: "retention" } });
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(async () => {
  await db.cronLease.updateMany({ where: { name: "retention" }, data: { claimedUntil: null } });
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("RET-INT-01 the retention cron purges only what the policy allows", () => {
  it("deletes old audit rows, nulls old IPs, purges terminal reminders, keeps payments", async () => {
    process.env.RETENTION_ENABLED = "true";
    const s = await seed();
    const auditRowsBefore = await purgeAuditRows();

    const res = await cron();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: false, truncated: false });
    expect(body.auditLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(body.ipAddressesCleared).toBeGreaterThanOrEqual(1);
    expect(body.reminderOccurrencesDeleted).toBeGreaterThanOrEqual(2);

    const after = await snapshot(s);
    // AuditLog: the 400-day row is gone; the 200-day row is kept without its IP.
    expect(after.audits.map((row) => row.id)).toEqual([s.audits.midAudit.id, s.audits.recentAudit.id]);
    expect(after.audits[0]).toMatchObject({ ipAddress: null, tenantId: s.audits.midAudit.tenantId });
    expect(after.audits[1].ipAddress).toBe("198.51.100.3");

    // Reminders: old SENT/FAILED gone with their deliveries; old PENDING and recent SENT kept.
    expect(after.occurrences.map((row) => row.id).sort()).toEqual(
      [s.occurrences.oldPending.id, s.occurrences.recentSent.id].sort(),
    );
    expect(after.deliveries.map((row) => row.occurrenceId).sort()).toEqual(
      [s.occurrences.oldPending.id, s.occurrences.recentSent.id].sort(),
    );

    // Financial records are untouched.
    expect(after.invoice).not.toBeNull();
    expect(after.attempt).toEqual(s.payments.attempt);
    expect(after.paymentEvent).toEqual(s.payments.paymentEvent);
    expect(after.payment).toEqual(s.payments.payment);

    // One audit row per run, system actor, no IP.
    expect(await purgeAuditRows()).toBe(auditRowsBefore + 1);
    const purgeRow = await db.auditLog.findFirst({ where: { action: "RETENTION_PURGE" }, orderBy: { createdAt: "desc" } });
    expect(purgeRow).toMatchObject({ entity: "Retention", userId: null, tenantId: null, ipAddress: null });
    expect(purgeRow?.details).toMatchObject({ dryRun: false, auditLogsDeleted: body.auditLogsDeleted });

    // The lease is released and the run recorded.
    const lease = await db.cronLease.findUnique({ where: { name: "retention" } });
    expect(lease?.claimedUntil).toBeNull();
    expect(lease?.lastRunAt).toBeInstanceOf(Date);

    // A second run finds nothing left to null or delete: the cursor terminates.
    const again = await (await cron()).json();
    expect(again).toMatchObject({ ipAddressesCleared: 0, auditLogsDeleted: 0, reminderOccurrencesDeleted: 0 });
    expect((await snapshot(s)).audits).toHaveLength(2);
  });

  it("answers 500 with the partial counts and still audits a run that fails part-way", async () => {
    process.env.RETENTION_ENABLED = "true";
    const s = await seed();
    const auditRowsBefore = await purgeAuditRows();
    // Step (c) fails in the database: a trigger rejects every reminder delete.
    await db.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION ret_int_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated failure for ${s.marker}'; END $$ LANGUAGE plpgsql`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ret_int_fail BEFORE DELETE ON "InvoiceReminderOccurrence" FOR EACH STATEMENT EXECUTE FUNCTION ret_int_fail()`,
    );
    let res: Response;
    try {
      res = await cron();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ret_int_fail ON "InvoiceReminderOccurrence"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ret_int_fail()`);
    }
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ error: "Retention purge failed", failedStep: "reminderOccurrences" });
    expect(body.partial.auditLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(body.partial.ipAddressesCleared).toBeGreaterThanOrEqual(1);
    expect(body.partial.reminderOccurrencesDeleted).toBe(0);

    // Steps (a) and (b) committed; (c) did not.
    const after = await snapshot(s);
    expect(after.audits.map((row) => row.id)).toEqual([s.audits.midAudit.id, s.audits.recentAudit.id]);
    expect(after.occurrences).toHaveLength(4);

    // The committed deletions are audited, flagged as failed, without the error text.
    expect(await purgeAuditRows()).toBe(auditRowsBefore + 1);
    const purgeRow = await db.auditLog.findFirst({ where: { action: "RETENTION_PURGE" }, orderBy: { createdAt: "desc" } });
    expect(purgeRow?.details).toEqual({ ...body.partial, failed: true, failedStep: "reminderOccurrences" });
    expect(JSON.stringify(purgeRow?.details)).not.toContain(s.marker);

    const lease = await db.cronLease.findUnique({ where: { name: "retention" } });
    expect(lease?.claimedUntil).toBeNull();
  });

  it("returns 500 and purges nothing when RETENTION_IP_DAYS exceeds RETENTION_AUDIT_LOG_DAYS", async () => {
    process.env.RETENTION_ENABLED = "true";
    process.env.RETENTION_IP_DAYS = "400";
    process.env.RETENTION_AUDIT_LOG_DAYS = "365";
    const s = await seed();
    const before = await snapshot(s);

    const res = await cron();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/RETENTION_IP_DAYS must not exceed RETENTION_AUDIT_LOG_DAYS/);
    expect(await snapshot(s)).toEqual(before);
  });
});

describe("RET-INT-02 dry run", () => {
  it("only counts and changes nothing (also without RETENTION_ENABLED)", async () => {
    const s = await seed();
    const before = await snapshot(s);
    const auditRowsBefore = await purgeAuditRows();

    const res = await cron("?dryRun=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: true, batches: 0, truncated: false });
    expect(body.auditLogsDeleted).toBeGreaterThanOrEqual(1);
    expect(body.ipAddressesCleared).toBeGreaterThanOrEqual(1);
    expect(body.reminderOccurrencesDeleted).toBeGreaterThanOrEqual(2);

    expect(await snapshot(s)).toEqual(before);
    expect(await purgeAuditRows()).toBe(auditRowsBefore);
  });

  it("RETENTION_DRY_RUN=true makes a scheduled run count only", async () => {
    process.env.RETENTION_ENABLED = "true";
    process.env.RETENTION_DRY_RUN = "true";
    const s = await seed();
    const before = await snapshot(s);

    const body = await (await cron()).json();
    expect(body.dryRun).toBe(true);
    expect(await snapshot(s)).toEqual(before);
  });
});

describe("RET-INT-03 first-run gate", () => {
  it("skips without RETENTION_ENABLED=true and writes nothing", async () => {
    const s = await seed();
    const before = await snapshot(s);
    const auditRowsBefore = await purgeAuditRows();

    const res = await cron();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "disabled" });
    expect(await snapshot(s)).toEqual(before);
    expect(await purgeAuditRows()).toBe(auditRowsBefore);
  });

  it("rejects a request without the cron bearer", async () => {
    const res = await retentionCron(request("/api/cron/retention"));
    expect(res.status).toBe(401);
  });
});

describe("RET-INT-04 lease", () => {
  it("skips while another run holds the lease, and runs once it has expired", async () => {
    process.env.RETENTION_ENABLED = "true";
    const s = await seed();
    const before = await snapshot(s);
    await db.cronLease.upsert({
      where: { name: "retention" },
      create: { name: "retention", claimedUntil: new Date(Date.now() + 5 * 60 * 1000) },
      update: { claimedUntil: new Date(Date.now() + 5 * 60 * 1000) },
    });

    const locked = await cron();
    expect(locked.status).toBe(200);
    expect(await locked.json()).toEqual({ skipped: "locked" });
    expect(await snapshot(s)).toEqual(before);

    // A crashed run's lease only blocks until claimedUntil passes.
    await db.cronLease.update({ where: { name: "retention" }, data: { claimedUntil: new Date(Date.now() - 1000) } });
    const res = await cron();
    expect((await res.json()).dryRun).toBe(false);
    expect((await snapshot(s)).audits).toHaveLength(2);
  });
});
