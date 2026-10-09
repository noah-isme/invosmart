// F12 Workspaces, reminder delivery through the crons: WS-10, WS-11
// (plan .plans/e2e-scenarios.md, "F12 Workspaces, RBAC, team operations").
// WS-INT-03 (one InvoiceReminderOccurrence per invoice/rule) and WS-12
// (RETRY -> SENT with a backdated nextAttemptAt) are in the integration layer.
//
// Verified against the code:
// - Cron auth (lib/cron-auth.ts): `Authorization: Bearer <CRON_SECRET>`; any
//   other header (or none, or a query-string secret) is 401. The e2e app runs
//   NODE_ENV=production with CRON_SECRET set (playwright.env.ts), so the
//   "open when unset outside production" branch never applies here. A session
//   cookie does not authorize a cron. Vercel calls the crons with GET
//   (vercel.json); every call here is a GET.
// - GET /api/cron/reminders (GET only) walks EVERY enabled rule of EVERY
//   workspace and creates an occurrence for each SENT/UNPAID/OVERDUE invoice
//   of that workspace whose scheduledAt = dueAt + offsetDays * 24h (UTC epoch
//   ms, lib/team/reminders.ts getReminderOccurrenceAt; no calendar/timezone
//   rounding) lies in (now - 24h, now]. occurrenceKey is unique, so a re-run
//   creates nothing new. The invoice here is due now + 3d - 1h, so with the
//   factory's default rule (offsetDays -3, EMAIL) scheduledAt is now - 1h:
//   inside the window regardless of the UTC/Asia-Jakarta date.
// - GET /api/cron/reminder-delivery (lib/team/reminder-delivery.ts
//   dispatchReminderDeliveries) takes due PENDING/RETRY/PROCESSING occurrences
//   (all workspaces), upserts one delivery per (occurrence, channel), claims
//   it and sends through Resend (RESEND_BASE_URL = stub) with
//   to = client_rel.email, subject "Invoice #<number> reminder from <name>",
//   tags invoice_id / reminder_occurrence (= occurrenceKey) / reminder_attempt,
//   and the SDK's `Idempotency-Key` header
//   "reminder-delivery:v1:<occurrenceKey>:EMAIL". SENT rows are never resent.
// - Crons are global: other specs' rules and invoices may produce stub calls
//   too, so assertions only look at stub requests to this test's (unique)
//   client email and never at global counts. Rules here are EMAIL-only and
//   live in a fresh isolated workspace (Slack endpoints only exist in
//   rule-less workspaces, WS-09).
import { createReminderOccurrenceKey } from "../../../../lib/team/reminders";
import { expect, test, type Api, type ApiUser, type StubRequest } from "../../fixtures";
import { E2E_SECRETS } from "../../playwright.env";
import { uniqueEmail } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const CRON_REMINDERS = "/api/cron/reminders";
const CRON_DELIVERY = "/api/cron/reminder-delivery";
const BEARER = { authorization: `Bearer ${E2E_SECRETS.CRON_SECRET}` };
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type ResendEmail = {
  to: string | string[];
  subject: string;
  html: string;
  tags?: Array<{ name: string; value: string }>;
};

/** GET a cron route with the bearer; expects 200 and returns the JSON body. */
async function runCron(api: Api, path: string): Promise<Record<string, unknown>> {
  const response = await api.get(path, { headers: BEARER });
  expect(response.status(), `GET ${path}`).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(body.success, `GET ${path} success`).toBe(true);
  return body;
}

/** Stub /resend/emails POSTs addressed to `email` (crons are global). */
async function emailsTo(stub: { requests(prefix?: string): Promise<StubRequest[]> }, email: string) {
  const calls = (await stub.requests("/resend/emails")).filter((entry) => entry.method === "POST");
  return calls.filter((entry) => [(entry.json as ResendEmail | undefined)?.to].flat().includes(email));
}

/**
 * Fresh isolated user + EMAIL-only rule (3 days before due) + a client with a
 * unique email + a SENT invoice due now + 3d - 1h for that client.
 */
async function setUpReminder({ api, factory, user }: ApiUser, tag: string) {
  const organizationId = user.workspace.organizationId;
  const rule = await factory.createReminderRule(organizationId, { offsetDays: -3, channels: ["EMAIL"] });
  expect(rule.channels).toEqual(["EMAIL"]);
  expect(rule.offsetDays).toBe(-3);

  const clientEmail = uniqueEmail(`${tag}-client`);
  const client = await factory.createClient({ email: clientEmail });
  const invoice = await factory.createInvoice({
    clientId: client.id,
    client: client.name,
    status: "SENT",
    dueAt: new Date(Date.now() + 3 * DAY_MS - HOUR_MS),
  });
  expect(invoice.status).toBe("SENT");
  expect(invoice.clientId).toBe(client.id);

  const occurrenceKey = createReminderOccurrenceKey({
    organizationId,
    invoiceId: invoice.id,
    ruleId: rule.id,
    dueAt: invoice.dueAt!,
    offsetDays: rule.offsetDays,
  });
  return { api, organizationId, rule, client, clientEmail, invoice, occurrenceKey };
}

test.describe("reminder crons", () => {
  test(
    "WS-10 an EMAIL-only rule (3 days before due) sends exactly one reminder to the client across repeated cron runs",
    { annotation: covers(CRON_REMINDERS, CRON_DELIVERY, "/api/workspaces/[id]/reminder-rules") },
    async ({ newApiUser, stub }) => {
      const { api, clientEmail } = await setUpReminder(await newApiUser("ws10"), "ws10");

      const first = await runCron(api, CRON_REMINDERS);
      // Global count: at least this test's occurrence was materialized.
      expect(first.created as number).toBeGreaterThanOrEqual(1);
      await runCron(api, CRON_REMINDERS);
      await runCron(api, CRON_DELIVERY);
      await runCron(api, CRON_DELIVERY);

      const sent = await emailsTo(stub, clientEmail);
      expect(sent).toHaveLength(1);

      // A third pass of both crons still sends nothing new to this client.
      await runCron(api, CRON_REMINDERS);
      await runCron(api, CRON_DELIVERY);
      expect(await emailsTo(stub, clientEmail)).toHaveLength(1);
    },
  );

  test(
    "WS-11 the delivery cron emails the invoice's client with the occurrence in the idempotency key and tags; no bearer -> 401",
    { annotation: covers(CRON_REMINDERS, CRON_DELIVERY) },
    async ({ newApiUser, stub }) => {
      const { api, clientEmail, invoice, occurrenceKey } = await setUpReminder(await newApiUser("ws11"), "ws11");

      // Without the bearer (a session cookie is not enough), with a wrong one,
      // or with the secret in the query string: 401, and nothing is sent.
      for (const path of [CRON_REMINDERS, CRON_DELIVERY]) {
        expect((await api.get(path)).status(), `${path} without bearer`).toBe(401);
        expect((await api.get(path, { headers: { authorization: "Bearer wrong-secret" } })).status(), `${path} wrong bearer`).toBe(401);
        expect((await api.get(`${path}?secret=${E2E_SECRETS.CRON_SECRET}`)).status(), `${path} query secret`).toBe(401);
      }
      expect(await emailsTo(stub, clientEmail)).toHaveLength(0);

      await runCron(api, CRON_REMINDERS);
      const delivery = await runCron(api, CRON_DELIVERY);
      expect((delivery.summary as { sent: number }).sent).toBeGreaterThanOrEqual(1);

      const sent = await emailsTo(stub, clientEmail);
      expect(sent).toHaveLength(1);
      const [call] = sent;
      const email = call.json as ResendEmail;
      expect([email.to].flat()).toEqual([clientEmail]);
      expect(email.subject).toContain(`Invoice #${invoice.number} reminder`);
      expect(call.headers["idempotency-key"]).toBe(`reminder-delivery:v1:${occurrenceKey}:EMAIL`);
      expect(email.tags).toEqual(
        expect.arrayContaining([
          { name: "invoice_id", value: invoice.id },
          { name: "reminder_occurrence", value: occurrenceKey },
          { name: "reminder_attempt", value: "1" },
        ]),
      );
      expect(call.headers.authorization).toBe(`Bearer ${E2E_SECRETS.RESEND_API_KEY}`);
    },
  );
});
