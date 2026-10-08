import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock, auditMock } = vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_webhook_route_test";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_webhook_route_test";

  return {
    dbMock: {
      paymentAttempt: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
      paymentEvent: { findFirst: vi.fn(), create: vi.fn() },
      payment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      invoice: { findUnique: vi.fn(), update: vi.fn() },
      $transaction: vi.fn(),
    },
    auditMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit/auditLogger", () => ({
  logAuditEvent: auditMock,
  AuditAction: { INVOICE_UPDATE: "INVOICE_UPDATE" },
  AuditEntity: { INVOICE: "Invoice" },
}));

import { POST } from "@/app/api/payments/stripe/webhook/route";

function expectNoDatabaseAccess() {
  for (const model of Object.values(dbMock)) {
    if (typeof model === "function") {
      expect(model).not.toHaveBeenCalled();
      continue;
    }
    for (const fn of Object.values(model)) {
      expect(fn).not.toHaveBeenCalled();
    }
  }
  expect(auditMock).not.toHaveBeenCalled();
}

function webhookRequest(headers: Record<string, string> = {}, body = '{"id":"evt_junk"}') {
  return new Request("https://app.example.test/api/payments/stripe/webhook", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/payments/stripe/webhook signature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_webhook_route_test";
  });

  it("returns 400 and touches no data when the stripe-signature header is missing", async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing signature" });
    expectNoDatabaseAccess();
  });

  it("returns 400 and touches no data when the signature is invalid", async () => {
    const response = await POST(
      webhookRequest({ "stripe-signature": "t=1700000000,v1=deadbeef" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid signature" });
    expectNoDatabaseAccess();
  });

  it("returns 400 for a malformed signature header", async () => {
    const response = await POST(webhookRequest({ "stripe-signature": "not-a-signature" }));

    expect(response.status).toBe(400);
    expectNoDatabaseAccess();
  });

  it("fails closed with 503 when the webhook secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const response = await POST(
      webhookRequest({ "stripe-signature": "t=1700000000,v1=deadbeef" })
    );

    expect(response.status).toBe(503);
    expectNoDatabaseAccess();
  });
});
