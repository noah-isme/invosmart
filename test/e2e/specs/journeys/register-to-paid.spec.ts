// JRN-01 (plan .plans/e2e-scenarios.md, "Cross-feature journeys"): a new
// account goes from registration to a paid, exported and audited invoice.
//
// Verified against the code (details in the per-feature specs):
// - Registration provisions the personal workspace (createUserWithPersonalWorkspace),
//   so the UI login lands in a usable /app with no extra API call.
// - /app/clients/new (ClientFormPage) POSTs /api/clients and routes to
//   /app/clients. /app/invoices/new "Kirim Invoice" POSTs /api/invoices with
//   status SENT (InvoiceFormClient submit("SEND")) and routes to the detail
//   page; this also covers the legacy invoice-flow.spec.ts send path.
// - "Send Email" -> SendEmailModal -> POST /api/invoices/<id>/send-email ->
//   Resend (stub /resend/emails); audit INVOICE_EMAIL_ACCEPTED (tenanted).
// - "Pay Now" -> PaymentGatewayModal -> "Midtrans" -> POST
//   /api/payments/midtrans/create, snap.js mapped to the stub by the guards
//   fixture, snap.pay onSuccess -> ?payment=success. The settlement is a
//   signed notification for the attempt's order id and amount; the settlement
//   audit row is INVOICE_UPDATE with details.event PAYMENT_RECEIVED.
// - The dashboard "Export CSV" button only window.open()s
//   /api/invoices/export?format=csv in a new tab, so the CSV is read from that
//   URL with the user's session (export.spec.ts does the same).
// - Audit: GET /api/admin/audit-logs is workspace-scoped (rows whose tenantId
//   is the caller's workspace). AUTH_REGISTER (the provisioned personal
//   workspace), AUTH_LOGIN_SUCCESS (the active workspace) and the payment
//   settlement row (invoice.organizationId) are tenanted, so the workspace
//   listing shows every step; the platform admin's global page (User ID
//   filter) lists them too. JRN-01b pins the tenant on the payment row.
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { ClientFormPage } from "../../pages/ClientFormPage";
import { InvoiceFormPage } from "../../pages/InvoiceFormPage";
import { LoginPage } from "../../pages/LoginPage";
import { RegisterPage } from "../../pages/RegisterPage";
import {
  apiRequest,
  getPaymentAttempt,
  midtransNotification,
  postMidtransNotification,
  uniqueEmail,
  type InvoiceRecord,
} from "../../support/api-factories";
import { getSessionUser } from "../../support/auth";
import { jakartaDate } from "../../support/dates";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const idr = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);

const statValue = (page: Page, label: string) =>
  page.locator("article").filter({ has: page.getByText(label, { exact: true }) }).locator("p").nth(1);

/** `datetime-local` value for today + `days` at 10:00 local time. */
const localDateTime = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type AuditRow = { action: string; entity: string; entityId: string | null; tenantId: string | null; userId: string | null; details: Record<string, unknown> | null };

test.describe("journey: register to paid", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "JRN-01 register -> client -> invoice -> email -> Pay Now (Midtrans) -> settlement -> dashboard PAID and revenue -> CSV -> audit trail",
    {
      tag: "@smoke",
      annotation: [
        ...covers(
          "/auth/register",
          "/auth/login",
          "/app/clients/new",
          "/api/clients",
          "/app/invoices/new",
          "/api/invoices",
          "/app/invoices/[id]",
          "/api/invoices/[id]/send-email",
          "/api/payments/midtrans/create",
          "/api/payments/midtrans/notification",
          "/app/dashboard",
          "/api/invoices/export",
          "/api/admin/audit-logs",
          "/app/admin/audit-logs",
        ),
      ],
    },
    async ({ page, stub, persona }) => {
      const started = Date.now();
      const id = tag();
      const account = { name: `JRN-01 Owner ${id}`, email: uniqueEmail("jrn01"), password: "E2e-Passw0rd!" };

      // 1. Register and sign in through the UI.
      const register = new RegisterPage(page);
      await register.goto();
      await register.register(account);
      await expect(page).toHaveURL(/\/auth\/login\?registered=1$/);
      const login = new LoginPage(page);
      await expect(login.formSuccess).toContainText("Registrasi berhasil");
      await login.signIn(account.email, account.password);
      await expect(page).toHaveURL(/\/app(\/|$)/);
      const sessionUser = (await getSessionUser(page.request))!;
      expect(sessionUser.email).toBe(account.email);
      const request = page.request;

      // 2. Client through the form.
      const clientName = `JRN-01 Klien ${id}`;
      const clientEmail = uniqueEmail("jrn01-client");
      const clientForm = new ClientFormPage(page);
      await clientForm.gotoNew();
      await clientForm.fill({ name: clientName, email: clientEmail, currency: "IDR" });
      const clientResponse = await clientForm.submit();
      expect(clientResponse.status()).toBe(201);
      const { data: client } = (await clientResponse.json()) as { data: { id: string; organizationId: string } };
      await expect(page).toHaveURL(/\/app\/clients$/);
      const organizationId = client.organizationId;

      // 3. Invoice through the form, sent right away ("Kirim Invoice").
      const items = [{ name: "JRN-01 desain", qty: 2, price: 350_000 }];
      const total = 700_000 + Math.round(700_000 * 0.1);
      const form = new InvoiceFormPage(page);
      await form.goto();
      await form.fill({ client: clientName, dueAt: localDateTime(14), items });
      const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/invoices" && r.request().method() === "POST");
      await form.sendButton.click();
      const createdResponse = await created;
      expect(createdResponse.status()).toBe(201);
      const { data: invoice } = (await createdResponse.json()) as { data: InvoiceRecord };
      expect(invoice).toMatchObject({ status: "SENT", total, client: clientName, organizationId });
      await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}$`));
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();

      // 4. Email through the stubbed Resend.
      await page.getByRole("button", { name: "Send Email" }).click();
      const emailDialog = page.getByRole("dialog", { name: "Send Invoice via Email" });
      await expect(emailDialog.getByRole("heading", { name: "Send Invoice via Email" })).toBeVisible();
      await emailDialog.getByLabel("Recipient Email").fill(clientEmail);
      const sent = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}/send-email`);
      await emailDialog.getByRole("button", { name: "Send Email" }).click();
      expect((await sent).status()).toBe(200);
      await expect(emailDialog.getByText("Email sent successfully!")).toBeVisible();
      const emails = (await stub.requests("/resend/emails")).filter((entry) => entry.method === "POST");
      expect(emails).toHaveLength(1);
      expect([(emails[0].json as { to: string | string[] }).to].flat()).toEqual([clientEmail]);

      // 5. Pay Now -> Midtrans (snap.js served by the stub through the guards).
      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => typeof (window as unknown as { snap?: { pay?: unknown } }).snap?.pay))
        .toBe("function");
      await page.getByRole("button", { name: "Pay Now" }).click();
      await expect(page.getByRole("heading", { name: "Select Payment Method" })).toBeVisible();
      const midtransCreate = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/payments/midtrans/create" && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: /Midtrans/ }).click();
      const createResponse = await midtransCreate;
      expect(createResponse.status()).toBe(200);
      const attemptRef = (await createResponse.json()) as { attemptId: string; orderId: string };
      await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}\\?payment=success$`));

      // 6. Forged, correctly signed settlement for the attempt.
      const pending = await getPaymentAttempt(request, attemptRef.attemptId);
      expect(pending).toMatchObject({ status: "PENDING", amount: total, currency: "IDR" });
      const settlement = await postMidtransNotification(
        request,
        midtransNotification({ orderId: attemptRef.orderId, grossAmount: pending.amount, currency: pending.currency }),
      );
      expect(settlement.status()).toBe(200);
      const settled = await getPaymentAttempt(request, attemptRef.attemptId);
      expect(settled).toMatchObject({ status: "SETTLED", invoice: { status: "PAID" } });
      expect(settled.payments).toHaveLength(1);

      // 7. Dashboard: PAID and the revenue.
      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Dashboard invoice" })).toBeVisible();
      await expect(statValue(page, "Total pendapatan")).toHaveText(idr(total));
      const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: invoice.number }) });
      await expect(row).toBeVisible();
      await expect(page.getByRole("radio", { name: "Paid", exact: true }).locator("span").nth(1)).toHaveText("1");

      // 8. CSV export has the PAID row.
      const csv = await apiRequest(request, "GET", "/api/invoices/export?format=csv");
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-type"]).toContain("text/csv");
      const lines = (await csv.text()).trim().split(/\r?\n/);
      expect(lines[0]).toBe("Invoice Number,Client Name,Status,Issued Date,Due Date,Total,Currency");
      const csvRow = lines.find((line) => line.startsWith(`${invoice.number},`));
      expect(csvRow?.split(",")).toEqual([invoice.number, clientName, "PAID", jakartaDate(invoice.issuedAt), jakartaDate(invoice.dueAt!), String(total), "IDR"]);

      // 9. Audit: the workspace listing has every step, registration, sign-in
      // and the payment settlement included...
      await expect
        .poll(async () => {
          const response = await apiRequest(request, "GET", "/api/admin/audit-logs?limit=100");
          const { logs } = (await response.json()) as { logs: AuditRow[] };
          return [
            ...new Set(
              logs
                .filter((log) => [client.id, invoice.id, sessionUser.id, null].includes(log.entityId))
                .map((log) => `${log.action}:${log.entity}`),
            ),
          ].sort();
        }, { message: "workspace audit trail" })
        .toEqual([
          "AUTH_LOGIN_SUCCESS:Auth",
          "AUTH_REGISTER:User",
          "CLIENT_CREATE:Client",
          "INVOICE_CREATE:Invoice",
          "INVOICE_EMAIL_ACCEPTED:Invoice",
          "INVOICE_EXPORT:Invoice",
          "INVOICE_UPDATE:Invoice",
        ]);

      // ...and the platform admin's global page (by user) lists every step.
      const admin = await persona("platformAdmin");
      const expectedTrail = ["AUTH_REGISTER", "CLIENT_CREATE", "INVOICE_CREATE", "INVOICE_EMAIL_ACCEPTED", "INVOICE_UPDATE", "INVOICE_EXPORT"];
      await expect
        .poll(
          async () => {
            await admin.page.goto(`/app/admin/audit-logs?${new URLSearchParams({ userId: sessionUser.id })}`);
            const actions = await admin.page.locator("tbody tr").locator("td:nth-child(2)").allInnerTexts();
            return expectedTrail.filter((action) => actions.map((text) => text.trim()).includes(action));
          },
          { message: "global audit trail for the new user" },
        )
        .toEqual(expectedTrail);
      const paymentRow = admin.page.locator("tbody tr").filter({ hasText: "INVOICE_UPDATE" }).filter({ hasText: invoice.id });
      await expect(paymentRow).toHaveCount(1);
      await expect(paymentRow).toContainText("PAYMENT_RECEIVED");

      test.info().annotations.push({ type: "duration", description: `JRN-01 body ${Date.now() - started} ms` });
      expect(Date.now() - started, "JRN-01 must finish within 60 s").toBeLessThan(60_000);
    },
  );

  test(
    "JRN-01b the Midtrans settlement audit row belongs to the invoice's workspace",
    { annotation: covers("/api/payments/midtrans/notification", "/api/admin/audit-logs") },
    async ({ newApiUser }) => {
      const { api, factory } = await newApiUser("jrn01b");
      const invoice = await factory.createInvoice({ status: "SENT" });
      expect(invoice.organizationId).toBeTruthy();
      await factory.payInvoiceViaMidtrans(invoice);
      await expect
        .poll(
          async () => {
            const { logs } = (await (await api.get("/api/admin/audit-logs?entity=Invoice&action=INVOICE_UPDATE")).json()) as { logs: AuditRow[] };
            return logs.some(
              (log) => log.entityId === invoice.id && log.details?.event === "PAYMENT_RECEIVED" && log.tenantId === invoice.organizationId,
            );
          },
          { timeout: 5_000 },
        )
        .toBe(true);
    },
  );
});
