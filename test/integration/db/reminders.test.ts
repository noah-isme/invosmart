// WS-INT-03 (one occurrence per invoice/rule after repeated cron runs) and
// WS-12 (a 500 from Resend puts the delivery row in RETRY; once due it goes
// to SENT on the same row). Resend is the provider stub (RESEND_BASE_URL).
import { beforeEach, describe, expect, it } from "vitest";

import { GET as remindersCron } from "@/app/api/cron/reminders/route";
import { GET as deliveryCron } from "@/app/api/cron/reminder-delivery/route";
import { E2E_SECRETS } from "../../e2e/playwright.env";

import {
  DAY_MS,
  createInvoice,
  createUserWithWorkspace,
  db,
  forceStubStatus,
  request,
  resetStub,
  stubRequests,
  uid,
  waitFor,
} from "./harness/fixtures";

const cron = (path: string) =>
  request(path, { headers: { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` } });

async function runReminders() {
  const res = await remindersCron(cron("/api/cron/reminders"));
  expect(res.status).toBe(200);
  return res.json();
}

async function runDelivery() {
  const res = await deliveryCron(cron("/api/cron/reminder-delivery"));
  expect(res.status).toBe(200);
  return (await res.json()).summary as Record<string, number>;
}

/** An isolated workspace with an EMAIL-only rule 3 days before due and an invoice due in 3 days. */
async function reminderFixture() {
  const { user, organization } = await createUserWithWorkspace();
  const email = `int-client+${uid()}@invosmart.test`;
  const client = await db.client.create({
    data: { userId: user.id, organizationId: organization.id, name: "Reminder Client", email },
  });
  const rule = await db.invoiceReminderRule.create({
    data: { organizationId: organization.id, name: "3 days before due", offsetDays: -3, channels: ["EMAIL"] },
  });
  // Due a minute short of today+3d, so the occurrence is due now and inside
  // the cron's 24 h materialization window.
  const invoice = await createInvoice({
    userId: user.id,
    organizationId: organization.id,
    status: "SENT",
    dueAt: new Date(Date.now() + 3 * DAY_MS - 60_000),
    clientId: client.id,
    client: client.name,
  });
  return { organization, rule, invoice, email };
}

const emailsTo = async (email: string) =>
  (await stubRequests()).filter((r) => r.method === "POST" && r.path === "/resend/emails" && r.json?.to === email);

const deliveryAudits = (deliveryId: string, count: number) =>
  waitFor(async () => {
    const n = await db.auditLog.count({ where: { entityId: deliveryId } });
    return n >= count ? n : null;
  });

beforeEach(async () => {
  await resetStub();
});

describe("WS-INT-03 reminder occurrences are idempotent", () => {
  it("repeated reminder and delivery cron runs leave one occurrence, one delivery and one email", async () => {
    const { rule, invoice, email } = await reminderFixture();

    const firstRun = await runReminders();
    expect(firstRun.created).toBeGreaterThanOrEqual(1);
    await runReminders();
    await runDelivery();
    await runDelivery();

    const occurrences = await db.invoiceReminderOccurrence.findMany({ where: { invoiceId: invoice.id, ruleId: rule.id } });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].status).toBe("SENT");
    const deliveries = await db.invoiceReminderDelivery.findMany({ where: { occurrenceId: occurrences[0].id } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ channel: "EMAIL", status: "SENT", attempts: 1 });
    expect(await emailsTo(email)).toHaveLength(1);

    // A third materialization pass still does not add a row.
    await runReminders();
    expect(await db.invoiceReminderOccurrence.count({ where: { invoiceId: invoice.id, ruleId: rule.id } })).toBe(1);
    await deliveryAudits(deliveries[0].id, 1);
  });
});

describe("WS-12 reminder delivery retry", () => {
  it("a Resend 500 moves the row to RETRY; once due, the same row goes to SENT", async () => {
    const { invoice, email } = await reminderFixture();
    await runReminders();
    const occurrence = await db.invoiceReminderOccurrence.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    await forceStubStatus("/resend/emails", 500, 1);
    const failed = await runDelivery();
    expect(failed.retried).toBe(1);

    const retry = await db.invoiceReminderDelivery.findUniqueOrThrow({
      where: { occurrenceId_channel: { occurrenceId: occurrence.id, channel: "EMAIL" } },
    });
    expect(retry).toMatchObject({ status: "RETRY", attempts: 1, errorCode: "resend_http_500" });
    expect(retry.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect((await db.invoiceReminderOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } })).status).toBe("RETRY");

    // Not due yet: a run now does not send.
    const early = await runDelivery();
    expect(early.claimed).toBe(0);
    expect(await emailsTo(email)).toHaveLength(1);

    // Backdate nextAttemptAt; the next run retries the same row.
    await db.invoiceReminderDelivery.update({
      where: { id: retry.id },
      data: { nextAttemptAt: new Date(Date.now() - 60_000) },
    });
    const sent = await runDelivery();
    expect(sent.sent).toBe(1);

    const rows = await db.invoiceReminderDelivery.findMany({ where: { occurrenceId: occurrence.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: retry.id, status: "SENT", attempts: 2, errorCode: null });
    expect(rows[0].providerRef).toMatch(/^email_e2e_/);
    expect((await db.invoiceReminderOccurrence.findUniqueOrThrow({ where: { id: occurrence.id } })).status).toBe("SENT");

    // Both attempts reached the stub with the same idempotency key.
    const sends = await emailsTo(email);
    expect(sends).toHaveLength(2);
    const keys = new Set(sends.map((s) => s.headers["idempotency-key"]));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^reminder-delivery:v1:reminder:v1:[0-9a-f]{64}:EMAIL$/);
    expect(await db.invoiceReminderOccurrence.count({ where: { invoiceId: invoice.id } })).toBe(1);
    await deliveryAudits(retry.id, 2);
  });
});
