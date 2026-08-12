import { expect, test } from "@playwright/test";

/**
 * Browser-level contract coverage for the invoice delivery → payment handoff.
 *
 * The provider endpoints are deliberately intercepted so this test is safe to
 * run in CI and never sends an email or creates a real Midtrans transaction.
 * The request assertions still protect the client contract (method, payload,
 * and the provider identifiers returned to the next step).
 */
test.describe("Invoice delivery and payment handoff", () => {
  test("sends invoice email before starting a Midtrans checkout", async ({ page }) => {
    const invoiceId = "integration-invoice-001";
    const observedRequests: Array<{
      path: string;
      method: string;
      body: Record<string, unknown>;
    }> = [];

    await page.route(`**/api/invoices/${invoiceId}/send-email`, async (route) => {
      observedRequests.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        body: route.request().postDataJSON() as Record<string, unknown>,
      });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { messageId: "resend-message-001", status: "accepted" },
        }),
      });
    });

    await page.route("**/api/payments/midtrans/create", async (route) => {
      observedRequests.push({
        path: new URL(route.request().url()).pathname,
        method: route.request().method(),
        body: route.request().postDataJSON() as Record<string, unknown>,
      });

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "snap-token-001",
          orderId: "invoice-integration-invoice-001",
          status: "pending",
        }),
      });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async (id) => {
      const emailResponse = await fetch(`/api/invoices/${id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "client@example.com" }),
      });
      const email = await emailResponse.json();

      const paymentResponse = await fetch("/api/payments/midtrans/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id }),
      });
      const payment = await paymentResponse.json();

      return {
        emailStatus: emailResponse.status,
        email,
        paymentStatus: paymentResponse.status,
        payment,
      };
    }, invoiceId);

    expect(result.emailStatus).toBe(200);
    expect(result.email.data).toMatchObject({
      messageId: "resend-message-001",
      status: "accepted",
    });
    expect(result.paymentStatus).toBe(200);
    expect(result.payment).toMatchObject({
      token: "snap-token-001",
      orderId: "invoice-integration-invoice-001",
      status: "pending",
    });

    expect(observedRequests).toEqual([
      {
        path: `/api/invoices/${invoiceId}/send-email`,
        method: "POST",
        body: { to: "client@example.com" },
      },
      {
        path: "/api/payments/midtrans/create",
        method: "POST",
        body: { invoiceId },
      },
    ]);
  });
});
