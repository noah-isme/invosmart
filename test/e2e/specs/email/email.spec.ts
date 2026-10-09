// F4 Email delivery: MAIL-01..05 (plan .plans/e2e-scenarios.md, "F4 Email delivery").
//
// Verified against the code:
// - The detail page button is "Send Email" (not "Kirim Email"; "Kirim Invoice"
//   is the status dialog). It opens components/invoices/SendEmailModal.tsx
//   (dialog "Send Invoice via Email", field "Recipient Email", submit "Send
//   Email"), which POSTs /api/invoices/<id>/send-email { to }. On success it shows
//   "Email sent successfully!" and calls router.refresh() (one detail render);
//   on failure it shows the API's `error` and does not refresh.
// - The route sends through Resend (RESEND_BASE_URL = stub /resend): subject
//   "Invoice #<number> from <name>", tags invoice_id/invoice_attempt. On
//   acceptance it sets emailedAt, appends an "accepted" emailLog entry with the
//   provider messageId and moves a DRAFT to SENT. A provider error appends a
//   "failed" entry (retryable for 5xx -> 503) and changes nothing else.
// - Delivery state is persisted only in Invoice.emailLog (lib/invoice-delivery.ts);
//   no page renders it, but GET /api/invoices/<id> returns the whole row, so
//   MAIL-02/03 read it there.
// - app/api/webhooks/resend/route.ts verifies Standard Webhooks headers
//   (svix-id/-timestamp/-signature, or webhook-*) with RESEND_WEBHOOK_SECRET
//   (400 on any failure), matches the invoice by data.tags.invoice_id and the
//   entry by data.email_id, and deduplicates by the svix-id event id.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import { expect, test, type Api } from "../../fixtures";
import { E2E_SECRETS } from "../../playwright.env";
import { uniqueForwardedFor } from "../../support/auth";
import { reserveInvoiceDetailLoads } from "../../support/invoice-detail-budget";
import { signResend } from "../../support/webhooks";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));
const RESEND_WEBHOOK = "/api/webhooks/resend";

type EmailLogEntry = {
  to: string;
  status: string;
  attempt: number;
  messageId?: string;
  acceptedAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  providerStatus?: string;
  providerEventId?: string;
  retryable?: boolean;
  nextRetryAt?: string;
};
type InvoiceRow = { id: string; number: string; status: string; emailedAt: string | null; emailLog: EmailLogEntry[] | null };

const recipient = (tag: string) => `${tag}+${randomUUID().slice(0, 8)}@invosmart.test`;

async function getInvoiceRow(api: Api, id: string): Promise<InvoiceRow> {
  const response = await api.get(`/api/invoices/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: InvoiceRow }).data;
}

async function sendViaApi(api: Api, invoiceId: string, to: string): Promise<string> {
  const response = await api.post(`/api/invoices/${invoiceId}/send-email`, { data: { to } });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { messageId: string; status: string };
  expect(body.status).toBe("accepted");
  return body.messageId;
}

function resendEvent(type: string, input: { messageId: string; to: string; invoiceId: string }) {
  const now = new Date().toISOString();
  return {
    type,
    created_at: now,
    data: {
      created_at: now,
      email_id: input.messageId,
      from: "InvoSmart E2E <billing@invosmart.test>",
      to: [input.to],
      subject: "Invoice",
      tags: { invoice_id: input.invoiceId, invoice_attempt: "1" },
    },
  };
}

/** POST a Resend webhook the way Resend sends it: signed svix-* headers, no CSRF header. */
async function postResendEvent(
  api: Api,
  payload: string,
  headers: Record<string, string> = signResend(payload),
) {
  return api.request.post(RESEND_WEBHOOK, {
    headers: { "content-type": "application/json", "x-forwarded-for": uniqueForwardedFor(), ...headers },
    data: payload,
  });
}

async function openSendEmailDialog(page: Page) {
  await page.getByRole("button", { name: "Send Email" }).click();
  const dialog = page.getByRole("dialog", { name: "Send Invoice via Email" });
  // The dialog root is a zero-size wrapper (its panel is position: fixed), so
  // Playwright reports the root itself as hidden; check its title instead.
  await expect(dialog.getByRole("heading", { name: "Send Invoice via Email" })).toBeVisible();
  return dialog;
}

test.describe("email delivery", () => {
  test(
    "MAIL-01 sending from the detail page calls Resend with the recipient and the invoice number; the UI shows success",
    { tag: "@smoke", annotation: covers("/app/invoices/[id]", "/api/invoices/[id]/send-email") },
    async ({ persona, factory, api, stub }) => {
      const invoice = await factory.createInvoice();
      const to = recipient("mail01");

      // Data first, then one reservation for every render, then the page:
      // a reservation must stay close to its render (support/invoice-detail-budget.ts).
      // goto + router.refresh() after the send succeeds: two renders.
      await reserveInvoiceDetailLoads(2);
      const { page } = await persona("owner");
      await page.goto(`/app/invoices/${invoice.id}`);
      const dialog = await openSendEmailDialog(page);
      await dialog.getByLabel("Recipient Email").fill(to);
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}/send-email` && r.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Send Email" }).click();
      const response = await sent;
      expect(response.status()).toBe(200);
      const { messageId } = (await response.json()) as { messageId: string };
      await expect(dialog.getByText("Email sent successfully!")).toBeVisible();
      await expect(page.getByText(/^Last sent:/)).toBeVisible();

      const calls = (await stub.requests("/resend/emails")).filter((entry) => entry.method === "POST");
      expect(calls).toHaveLength(1);
      expect(calls[0].headers.authorization).toBe(`Bearer ${E2E_SECRETS.RESEND_API_KEY}`);
      const email = calls[0].json as { to: string | string[]; subject: string; from: string; html: string; tags: Array<{ name: string; value: string }> };
      expect([email.to].flat()).toEqual([to]);
      expect(email.subject).toContain(`Invoice #${invoice.number}`);
      expect(email.from).toBe("InvoSmart E2E <billing@invosmart.test>");
      expect(email.html).toContain(invoice.number);
      expect(email.tags).toEqual(
        expect.arrayContaining([
          { name: "invoice_id", value: invoice.id },
          { name: "invoice_attempt", value: "1" },
        ]),
      );

      const row = await getInvoiceRow(api, invoice.id);
      expect(row.status).toBe("SENT");
      expect(row.emailedAt).not.toBeNull();
      expect(row.emailLog).toEqual([expect.objectContaining({ to, status: "accepted", attempt: 1, messageId })]);
    },
  );

  test(
    "MAIL-02 a signed email.delivered webhook is accepted and the delivery state becomes delivered",
    { annotation: covers("/api/webhooks/resend", "/api/invoices/[id]/send-email", "/api/invoices/[id]") },
    async ({ factory, api }) => {
      const invoice = await factory.createInvoice();
      const to = recipient("mail02");
      const messageId = await sendViaApi(api, invoice.id, to);

      const payload = JSON.stringify(resendEvent("email.delivered", { messageId, to, invoiceId: invoice.id }));
      const headers = signResend(payload);
      const response = await postResendEvent(api, payload, headers);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ received: true, matched: true, status: "delivered" });

      const [entry] = (await getInvoiceRow(api, invoice.id)).emailLog ?? [];
      expect(entry).toMatchObject({
        to,
        messageId,
        status: "delivered",
        providerStatus: "email.delivered",
        providerEventId: headers["svix-id"],
      });
      expect(entry.deliveredAt).toBeTruthy();

      // Resend retries deliver the same svix-id: acknowledged, not re-applied.
      const replay = await postResendEvent(api, payload, headers);
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({ received: true, matched: true, duplicate: true });
    },
  );

  test(
    "MAIL-03 a webhook with a bad signature is 400 and changes nothing",
    { annotation: covers("/api/webhooks/resend") },
    async ({ factory, api }) => {
      const invoice = await factory.createInvoice();
      const to = recipient("mail03");
      const messageId = await sendViaApi(api, invoice.id, to);
      const before = await getInvoiceRow(api, invoice.id);

      const payload = JSON.stringify(resendEvent("email.delivered", { messageId, to, invoiceId: invoice.id }));
      const otherSecret = `whsec_${Buffer.from("not-the-e2e-resend-secret").toString("base64")}`;
      const cases: Array<[string, string, Record<string, string>]> = [
        ["wrong secret", payload, signResend(payload, { secret: otherSecret })],
        ["no signature headers", payload, {}],
        ["body changed after signing", payload.replace("email.delivered", "email.bounced"), signResend(payload)],
        ["timestamp outside tolerance", payload, signResend(payload, { timestamp: new Date(Date.now() - 10 * 60_000) })],
      ];
      for (const [label, body, headers] of cases) {
        const response = await postResendEvent(api, body, headers);
        expect(response.status(), label).toBe(400);
        expect(await response.json(), label).toEqual({ error: "Invalid webhook signature" });
      }

      const after = await getInvoiceRow(api, invoice.id);
      expect(after.emailLog).toEqual(before.emailLog);
      expect(after.emailLog?.[0]).toMatchObject({ status: "accepted", messageId });
    },
  );

  test(
    "MAIL-04 when Resend answers 500 the UI shows an error and no success state is persisted",
    { annotation: covers("/app/invoices/[id]", "/api/invoices/[id]/send-email") },
    async ({ persona, factory, api, stub }) => {
      const invoice = await factory.createInvoice();
      const to = recipient("mail04");
      await stub.force({ target: "/resend/emails", status: 500, count: 1 });

      // goto only (a failed send does not refresh); reserved before the page opens.
      await reserveInvoiceDetailLoads(1);
      const { page } = await persona("owner");
      await page.goto(`/app/invoices/${invoice.id}`);
      const dialog = await openSendEmailDialog(page);
      await dialog.getByLabel("Recipient Email").fill(to);
      const sent = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}/send-email` && r.request().method() === "POST",
      );
      await dialog.getByRole("button", { name: "Send Email" }).click();
      const response = await sent;
      // 5xx from the provider is retryable: 503 with Retry-After.
      expect(response.status()).toBe(503);
      expect(response.headers()["retry-after"]).toBeTruthy();
      await expect(dialog.getByText("Failed to send email")).toBeVisible();
      await expect(dialog.getByText("Email sent successfully!")).toHaveCount(0);
      await expect(page.getByText(/^Last sent:/)).toHaveCount(0);

      expect((await stub.requests("/resend/emails")).filter((entry) => entry.method === "POST")).toHaveLength(1);
      const row = await getInvoiceRow(api, invoice.id);
      expect(row.status).toBe("DRAFT");
      expect(row.emailedAt).toBeNull();
      expect(row.emailLog).toEqual([
        expect.objectContaining({ to, status: "failed", attempt: 1, providerStatus: "provider_rejected", retryable: true }),
      ]);
      expect(row.emailLog?.[0].messageId).toBeUndefined();
    },
  );

  test(
    "MAIL-05 staging Resend accepts an invoice email to the staging inbox",
    { tag: "@staging", annotation: covers("/api/invoices/[id]/send-email") },
    async ({ factory, api }) => {
      // The RUNBOOK "Email provider contract" (signed sent/delivered/bounced
      // events) needs the staging webhook; this spec covers the send.
      test.skip(process.env.E2E_TIER !== "staging", "Staging Resend runs on staging only (E2E_TIER=staging)");
      const inbox = process.env.E2E_STAGING_INBOX?.trim();
      test.skip(!inbox, "E2E_STAGING_INBOX is not set");
      const invoice = await factory.createInvoice();
      const messageId = await sendViaApi(api, invoice.id, inbox!);
      expect(messageId).toBeTruthy();
      test.info().annotations.push({ type: "provider-id", description: `resend email ${messageId}` });
    },
  );
});
