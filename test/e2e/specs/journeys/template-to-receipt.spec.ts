// JRN-03 (plan .plans/e2e-scenarios.md, "Cross-feature journeys"): an invoice
// made from a template is paid through Stripe Checkout and gets a publicly
// verifiable receipt.
//
// Verified against the code (details in specs/templates, specs/payments,
// specs/receipts):
// - /app/invoices/templates "Buat Invoice" POSTs .../instantiate and opens the
//   new DRAFT invoice. "Pay Now" is offered for SENT/UNPAID/OVERDUE only, so
//   the detail page's "Kirim Invoice" dialog ("Kirim") moves it to SENT first.
// - PaymentGatewayModal "Stripe" -> POST /api/payments/stripe/create-session;
//   the browser follows the session url to the stub's /checkout/<id> page.
//   The completion is a signed checkout.session.completed whose amount_total
//   is in Stripe minor units (IDR x100, toStripeMinorUnit).
// - POST /api/receipts/create takes the app's Payment row id and returns
//   { receiptId, receiptNo, verifyToken }; /receipts/<id>/verify?token=... is
//   public ("Receipt Terverifikasi").
import { expect, test } from "../../fixtures";
import { toStripeMinorUnit } from "../../../../lib/payments/money";
import type { InvoiceRecord } from "../../support/api-factories";
import { parseStripeSessionForm } from "../payments/payment-helpers";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test(
  "JRN-03 template -> instantiate -> send -> Stripe checkout -> signed completion -> receipt -> public verify",
  {
    annotation: covers(
      "/app/invoices/templates",
      "/api/invoices/templates/[id]/instantiate",
      "/app/invoices/[id]",
      "/api/invoices/[id]",
      "/api/payments/stripe/create-session",
      "/api/payments/stripe/webhook",
      "/api/payments/[attemptId]",
      "/api/receipts/create",
      "/receipts/[id]/verify",
    ),
  },
  async ({ isolatedUser, stub, payments, _newBrowserContext }) => {
    const { page, api, factory } = isolatedUser;
    const items = [{ name: `JRN-03 retainer ${tag()}`, qty: 1, price: 1_250_000 }];
    const template = (await factory.createTemplate({ name: `JRN-03 Template ${tag()}`, client: `JRN-03 Klien ${tag()}`, items })) as {
      id: string;
      name: string;
      client: string;
      total: number;
    };

    // 1. Instantiate from the templates page.
    await page.goto("/app/invoices/templates");
    await expect(page.getByRole("heading", { level: 1, name: "Template Invoice" })).toBeVisible();
    const card = page
      .locator("div")
      .filter({ has: page.getByRole("heading", { level: 3, name: template.name, exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Buat Invoice" }) })
      .last();
    const instantiated = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/invoices/templates/${template.id}/instantiate` && r.request().method() === "POST",
    );
    await card.getByRole("button", { name: "Buat Invoice" }).click();
    const instantiateResponse = await instantiated;
    expect(instantiateResponse.status()).toBe(201);
    const { data: invoice } = (await instantiateResponse.json()) as { data: InvoiceRecord };
    expect(invoice).toMatchObject({ status: "DRAFT", client: template.client, items, total: template.total, currency: "IDR" });
    await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}$`));

    // 2. Send it (DRAFT -> SENT) so "Pay Now" is offered.
    await expect(page.getByRole("button", { name: "Pay Now" })).toHaveCount(0);
    await page.getByRole("button", { name: "Kirim Invoice" }).click();
    const sendDialog = page.getByRole("alertdialog");
    await expect(sendDialog).toBeVisible();
    const statusPut = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}` && r.request().method() === "PUT");
    await sendDialog.getByRole("button", { name: "Kirim", exact: true }).click();
    expect((await statusPut).status()).toBe(200);
    await expect(page.getByRole("button", { name: "Pay Now" })).toBeVisible();

    // 3. Stripe checkout through the stub.
    await page.getByRole("button", { name: "Pay Now" }).click();
    await expect(page.getByRole("heading", { name: "Select Payment Method" })).toBeVisible();
    const sessionCreated = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/payments/stripe/create-session" && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Stripe/ }).click();
    expect((await sessionCreated).status()).toBe(200);
    const sessionId = await payments.waitForCheckoutPage(page);

    const calls = (await stub.requests("/v1/checkout/sessions")).filter((entry) => entry.method === "POST");
    expect(calls).toHaveLength(1);
    const session = parseStripeSessionForm(calls[0].body);
    expect(session.metadata.invoiceId).toBe(invoice.id);
    const attemptId = session.metadata.attemptId!;
    // IDR on Stripe is x100.
    expect(session.lineItemsTotal).toBe(toStripeMinorUnit(invoice.total, "IDR"));
    expect(session.lineItemsTotal).toBe(invoice.total * 100);
    const pending = await factory.getPaymentAttempt(attemptId);
    expect(pending).toMatchObject({ provider: "stripe", sessionId, status: "PENDING", amount: invoice.total, currency: "IDR" });

    // 4. Signed completion.
    const completed = await payments.postStripeEvent(
      payments.stripeCheckoutCompletedEvent({
        sessionId,
        attemptId,
        invoiceId: invoice.id,
        amountMinor: toStripeMinorUnit(pending.amount, pending.currency),
        currency: pending.currency,
      }),
    );
    expect(completed.status()).toBe(200);
    const settled = await factory.getPaymentAttempt(attemptId);
    expect(settled).toMatchObject({ status: "SETTLED", invoice: { id: invoice.id, status: "PAID" } });
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0]).toMatchObject({ paidAmount: invoice.total, paidCurrency: "IDR" });

    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay Now" })).toHaveCount(0);

    // 5. Receipt for the Payment row.
    const receiptResponse = await api.post("/api/receipts/create", {
      data: { paymentId: settled.payments[0].id, positionPreset: "bottom-right" },
    });
    expect(receiptResponse.status()).toBe(201);
    const receipt = (await receiptResponse.json()) as { receiptId: string; receiptNo: string; verifyToken: string };
    expect(receipt.receiptNo).toMatch(/^RCP-\d{6}-\d{4}$/);

    // 6. Public verification without a session.
    const anonymous = await (await _newBrowserContext({ cookies: [], origins: [] })).newPage();
    const verify = await anonymous.goto(`/receipts/${receipt.receiptId}/verify?token=${receipt.verifyToken}`);
    expect(verify?.status()).toBe(200);
    await expect(anonymous.getByRole("heading", { name: "Receipt Terverifikasi" })).toBeVisible();
    await expect(anonymous.getByText(receipt.receiptNo, { exact: true })).toBeVisible();
    await expect(anonymous.getByText(invoice.number, { exact: true })).toBeVisible();
    await expect(anonymous.getByText(template.client, { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const audit = await api.get(`/api/receipts/${receipt.receiptId}/audit`);
        return ((await audit.json()) as { data: Array<{ action: string }> }).data.map((row) => row.action);
      })
      .toEqual(["VERIFY_SUCCESS", "CREATE"]);
  },
);
