// Shared helpers for the F5 payment specs (not a spec file: testMatch is *.spec.ts).
import { randomUUID } from "node:crypto";

import { expect, type Api, type StubRequest } from "../../fixtures";
import type { InvoiceRecord, PaymentAttemptView } from "../../support/api-factories";

export const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

export const uniqueTag = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

export type MidtransCreated = {
  attemptId: string;
  orderId: string;
  status: string;
  expiresAt: string | null;
  token: string | null;
  redirectUrl: string | null;
};

export type StripeCreated = {
  attemptId: string;
  orderId: string;
  sessionId: string;
  status: string;
  expiresAt: string | null;
  url: string;
};

/** POST /api/payments/midtrans/create (200). */
export async function createMidtransAttempt(api: Api, invoiceId: string): Promise<MidtransCreated> {
  const response = await api.post("/api/payments/midtrans/create", { data: { invoiceId } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as MidtransCreated;
}

/** POST /api/payments/stripe/create-session (200). */
export async function createStripeSession(api: Api, invoiceId: string): Promise<StripeCreated> {
  const response = await api.post("/api/payments/stripe/create-session", { data: { invoiceId } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as StripeCreated;
}

/** GET /api/payments/<attemptId> (200). */
export async function getAttempt(api: Api, attemptId: string): Promise<PaymentAttemptView> {
  const response = await api.get(`/api/payments/${encodeURIComponent(attemptId)}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as PaymentAttemptView;
}

/** GET /api/invoices/<id> (200). */
export async function getInvoice(api: Api, invoiceId: string): Promise<InvoiceRecord & { paidAt: string | null }> {
  const response = await api.get(`/api/invoices/${encodeURIComponent(invoiceId)}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: InvoiceRecord & { paidAt: string | null } }).data;
}

/**
 * GET /api/payments?q=<client>: the PAID-invoice payment ledger of the active
 * workspace, filtered by the invoice's (unique) client name.
 */
export async function listPaymentsForClient(api: Api, client: string): Promise<Array<{ id: string; invoiceNo: string; amount: number }>> {
  const response = await api.get(`/api/payments?q=${encodeURIComponent(client)}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: Array<{ id: string; invoiceNo: string; amount: number }> }).items;
}

/** The single recorded Snap "create transaction" call. */
export function snapTransactionRequests(requests: StubRequest[]): StubRequest[] {
  return requests.filter((entry) => entry.method === "POST" && /^\/snap-(sandbox|production)\/v1\/transactions$/.test(entry.path));
}

export type MidtransSnapBody = {
  transaction_details: { order_id: string; gross_amount: number };
  item_details: Array<{ id: string; price: number; quantity: number; name: string }>;
  customer_details?: Record<string, unknown>;
};

/** Stripe Checkout session create body (form-encoded) as a flat map plus parsed line items. */
export function parseStripeSessionForm(body: string) {
  const form = new URLSearchParams(body);
  const lineItems: Array<{ name: string | null; currency: string | null; unitAmount: number; quantity: number }> = [];
  for (let i = 0; form.has(`line_items[${i}][quantity]`); i += 1) {
    lineItems.push({
      name: form.get(`line_items[${i}][price_data][product_data][name]`),
      currency: form.get(`line_items[${i}][price_data][currency]`),
      unitAmount: Number(form.get(`line_items[${i}][price_data][unit_amount]`)),
      quantity: Number(form.get(`line_items[${i}][quantity]`)),
    });
  }
  return {
    form,
    lineItems,
    lineItemsTotal: lineItems.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0),
    metadata: {
      invoiceId: form.get("metadata[invoiceId]"),
      attemptId: form.get("metadata[attemptId]"),
      orderId: form.get("metadata[orderId]"),
      userId: form.get("metadata[userId]"),
    },
  };
}
