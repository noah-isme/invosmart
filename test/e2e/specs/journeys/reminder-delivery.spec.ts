// JRN-04 (plan .plans/e2e-scenarios.md, "Cross-feature journeys"): a reminder
// rule turns an invoice that is due soon into one reminder email and an audit
// entry.
//
// Verified against the code (details in specs/reminders/reminders.spec.ts):
// - Both crons are GET with `Authorization: Bearer <CRON_SECRET>` and are
//   global, so the spec only looks at stub calls to its own client email.
// - With the default rule (offsetDays -3, EMAIL) and dueAt = now + 3d - 1h the
//   occurrence's scheduledAt is now - 1h, inside the (now - 24h, now] window.
// - lib/team/reminder-delivery.ts auditDelivery() writes
//   { tenantId: <workspace>, action: "INVOICE_REMINDER_SENT", entity:
//   "InvoiceReminderDelivery", entityId: <delivery id>, details: {
//   occurrenceKey, channel, attempts, providerRef, ... } } (no userId: the cron
//   acts as the system), so the workspace audit API lists it.
import { createReminderOccurrenceKey } from "../../../../lib/team/reminders";
import { expect, test, type Api } from "../../fixtures";
import { E2E_SECRETS } from "../../playwright.env";
import { uniqueEmail } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const BEARER = { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function runCron(api: Api, path: string) {
  const response = await api.get(path, { headers: BEARER });
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.success).toBe(true);
  return body;
}

type AuditRow = { action: string; entity: string; entityId: string | null; tenantId: string | null; userId: string | null; details: Record<string, unknown> | null };

test(
  "JRN-04 reminder rule -> invoice due soon -> reminders cron -> delivery cron -> one Resend email -> INVOICE_REMINDER_SENT audit entry",
  {
    annotation: covers(
      "/api/workspaces/[id]/reminder-rules",
      "/api/clients",
      "/api/invoices",
      "/api/cron/reminders",
      "/api/cron/reminder-delivery",
      "/api/admin/audit-logs",
    ),
  },
  async ({ newApiUser, stub }) => {
    const { api, factory, user } = await newApiUser("jrn04");
    const organizationId = user.workspace.organizationId;

    const rule = await factory.createReminderRule(organizationId, { offsetDays: -3, channels: ["EMAIL"] });
    const clientEmail = uniqueEmail("jrn04-client");
    const client = await factory.createClient({ email: clientEmail });
    const invoice = await factory.createInvoice({
      clientId: client.id,
      client: client.name,
      status: "SENT",
      dueAt: new Date(Date.now() + 3 * DAY_MS - HOUR_MS),
    });
    const occurrenceKey = createReminderOccurrenceKey({
      organizationId,
      invoiceId: invoice.id,
      ruleId: rule.id,
      dueAt: invoice.dueAt!,
      offsetDays: rule.offsetDays,
    });

    const reminders = await runCron(api, "/api/cron/reminders");
    expect(reminders.created as number).toBeGreaterThanOrEqual(1);
    await runCron(api, "/api/cron/reminder-delivery");

    const emails = (await stub.requests("/resend/emails")).filter(
      (entry) => entry.method === "POST" && [(entry.json as { to?: string | string[] } | undefined)?.to].flat().includes(clientEmail),
    );
    expect(emails).toHaveLength(1);
    const email = emails[0].json as { subject: string; tags?: Array<{ name: string; value: string }> };
    expect(email.subject).toContain(`Invoice #${invoice.number} reminder`);
    expect(email.tags).toEqual(expect.arrayContaining([{ name: "reminder_occurrence", value: occurrenceKey }]));

    let sentRow: AuditRow | undefined;
    await expect
      .poll(
        async () => {
          const response = await api.get(`/api/admin/audit-logs?${new URLSearchParams({ entity: "InvoiceReminderDelivery" })}`);
          expect(response.status()).toBe(200);
          const { logs } = (await response.json()) as { logs: AuditRow[] };
          sentRow = logs.find((log) => log.details?.occurrenceKey === occurrenceKey);
          return sentRow?.action;
        },
        { message: "INVOICE_REMINDER_SENT audit entry for this occurrence" },
      )
      .toBe("INVOICE_REMINDER_SENT");
    expect(sentRow).toMatchObject({ tenantId: organizationId, entity: "InvoiceReminderDelivery", userId: null });
    expect(sentRow!.details).toMatchObject({ occurrenceKey, channel: "EMAIL", status: "SENT" });
  },
);
