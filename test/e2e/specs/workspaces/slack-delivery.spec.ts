// [ST] Slack delivery (plan .plans/e2e-scenarios.md, "Seams": Slack delivery
// is staging-only; Step 24: the @staging specs AUTH-08, MAIL-05, PAY-12 and
// Slack delivery). Locally SLACK_WEBHOOK_URL is blank and Slack endpoints only
// exist in rule-less isolated workspaces (WS-09), so no local run ever posts
// to Slack.
//
// Both tests skip unless E2E_TIER=staging and run as the staging account
// (setup/staging.setup.ts). They work in one dedicated workspace of that
// account, "E2E staging Slack", found by name or created once, and restore
// the account's active workspace afterwards (POST /api/workspaces switches
// to the new workspace; the other @staging specs use the active one).
//
// - STG-SLACK-01 saves a Slack endpoint in that rule-less workspace and checks
//   it is stored redacted (no delivery can happen: no rule targets it).
// - STG-SLACK-02 runs only when E2E_STAGING_SLACK_WEBHOOK_URL (a real staging
//   Slack incoming webhook) and E2E_STAGING_CRON_SECRET are set: a SLACK-only
//   rule plus an invoice due soon, then both crons, then the
//   INVOICE_REMINDER_SENT audit entry with channel SLACK. Rule, endpoint and
//   invoice are removed in `finally`, so the workspace is rule-less again.
//   The crons are global: they also process any other due reminders on staging.
//
// Verified against the code: app/api/workspaces/[id]/notifications/route.ts
// (POST upserts the single SLACK endpoint, 200, redacted response),
// lib/team/slack.ts (https hooks.slack.com / hooks.slack-gov.com only),
// app/api/cron/reminders + reminder-delivery (GET with Bearer CRON_SECRET),
// lib/team/reminder-delivery.ts auditDelivery() (details.channel/status).
import { createReminderOccurrenceKey } from "../../../../lib/team/reminders";
import { expect, test, type Api, type Factory } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const WORKSPACE_NAME = "E2E staging Slack";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type Endpoint = Record<string, unknown> & { id: string; type: string; enabled: boolean };
type Rule = { id: string };
type AuditRow = { action: string; details: Record<string, unknown> | null };

/**
 * Run `body` with the dedicated workspace's id; the account's previously
 * active workspace is active again afterwards.
 */
async function inSlackWorkspace(factory: Factory, body: (organizationId: string) => Promise<void>) {
  const memberships = await factory.listWorkspaces();
  const previous = memberships.find((membership) => membership.active);
  const existing = memberships.find((membership) => membership.organization.name === WORKSPACE_NAME && membership.role === "OWNER");
  const workspace = existing ?? (await factory.createWorkspace({ name: WORKSPACE_NAME }));
  try {
    await body(workspace.organizationId);
  } finally {
    if (previous && previous.organizationId !== workspace.organizationId) await factory.switchWorkspace(previous.organizationId);
  }
}

async function listRules(api: Api, organizationId: string): Promise<Rule[]> {
  const response = await api.get(`/api/workspaces/${organizationId}/reminder-rules`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: Rule[] }).data;
}

async function runCron(api: Api, path: string, secret: string) {
  const response = await api.get(path, { headers: { authorization: `Bearer ${secret}` } });
  expect(response.status(), `GET ${path}`).toBe(200);
  expect(((await response.json()) as { success?: boolean }).success).toBe(true);
}

test.describe("staging: Slack delivery", { tag: "@staging" }, () => {
  test.beforeEach(() => {
    test.skip(process.env.E2E_TIER !== "staging", "Slack delivery runs on staging only (E2E_TIER=staging)");
  });

  test(
    "STG-SLACK-01 a Slack endpoint saved in a rule-less workspace is stored redacted",
    { annotation: covers("/api/workspaces/[id]/notifications", "/api/workspaces/[id]/notifications/[endpointId]") },
    async ({ api, factory }) => {
      await inSlackWorkspace(factory, async (organizationId) => {
        expect(await listRules(api, organizationId)).toEqual([]);
        const base = `/api/workspaces/${organizationId}/notifications`;
        const secretPath = `TE2E/BE2E/stg${Date.now().toString(36)}`;
        const saved = await api.post(base, {
          data: { type: "SLACK", webhookUrl: `https://hooks.slack.com/services/${secretPath}`, enabled: true },
        });
        expect(saved.status()).toBe(200);
        const savedText = await saved.text();
        expect(savedText).not.toContain(secretPath);
        const endpoint = (JSON.parse(savedText) as { data: Endpoint }).data;
        try {
          expect(endpoint).toMatchObject({ type: "SLACK", enabled: true });
          const listed = await api.get(base);
          expect(listed.status()).toBe(200);
          expect(await listed.text()).not.toContain("hooks.slack.com");
        } finally {
          expect((await api.delete(`${base}/${endpoint.id}`)).status()).toBe(200);
        }
      });
    },
  );

  test(
    "STG-SLACK-02 a SLACK reminder rule delivers to the staging Slack webhook and audits INVOICE_REMINDER_SENT",
    {
      annotation: covers(
        "/api/workspaces/[id]/notifications",
        "/api/workspaces/[id]/reminder-rules",
        "/api/cron/reminders",
        "/api/cron/reminder-delivery",
      ),
    },
    async ({ api, factory }) => {
      const webhookUrl = process.env.E2E_STAGING_SLACK_WEBHOOK_URL?.trim();
      const cronSecret = process.env.E2E_STAGING_CRON_SECRET?.trim();
      test.skip(!webhookUrl, "E2E_STAGING_SLACK_WEBHOOK_URL is not set");
      test.skip(!cronSecret, "E2E_STAGING_CRON_SECRET is not set");

      await inSlackWorkspace(factory, async (organizationId) => {
        expect(await listRules(api, organizationId)).toEqual([]);
        const endpoint = await factory.createSlackEndpoint(organizationId, { webhookUrl: webhookUrl!, enabled: true });
        const rule = await factory.createReminderRule(organizationId, { name: "E2E staging Slack", offsetDays: -3, channels: ["SLACK"] });
        let invoiceId: string | undefined;
        try {
          const invoice = await factory.createInvoice(
            { status: "SENT", dueAt: new Date(Date.now() + 3 * DAY_MS - HOUR_MS) },
            { organizationId },
          );
          invoiceId = invoice.id;
          const occurrenceKey = createReminderOccurrenceKey({
            organizationId,
            invoiceId: invoice.id,
            ruleId: rule.id,
            dueAt: invoice.dueAt!,
            offsetDays: rule.offsetDays,
          });

          await runCron(api, "/api/cron/reminders", cronSecret!);
          await runCron(api, "/api/cron/reminder-delivery", cronSecret!);

          await expect
            .poll(
              async () => {
                const response = await api.get(
                  `/api/admin/audit-logs?${new URLSearchParams({ entity: "InvoiceReminderDelivery" })}`,
                  { organizationId },
                );
                expect(response.status()).toBe(200);
                const { logs } = (await response.json()) as { logs: AuditRow[] };
                const row = logs.find((log) => log.details?.occurrenceKey === occurrenceKey);
                return row ? { action: row.action, channel: row.details?.channel, status: row.details?.status } : null;
              },
              { message: "INVOICE_REMINDER_SENT (SLACK) audit entry for this occurrence", timeout: 30_000 },
            )
            .toEqual({ action: "INVOICE_REMINDER_SENT", channel: "SLACK", status: "SENT" });
        } finally {
          // Leave the workspace rule-less, endpoint-less and invoice-less.
          const base = `/api/workspaces/${organizationId}`;
          expect((await api.delete(`${base}/reminder-rules/${rule.id}`)).status()).toBe(200);
          expect((await api.delete(`${base}/notifications/${endpoint.id}`)).status()).toBe(200);
          if (invoiceId) await api.delete(`/api/invoices/${invoiceId}`, { organizationId });
        }
      });
    },
  );
});
