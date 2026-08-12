import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoiceMock, verifyMock, auditMock } = vi.hoisted(() => ({
  invoiceMock: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  verifyMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { invoice: invoiceMock } }));
vi.mock("@/lib/email/resend", () => ({ verifyResendWebhook: verifyMock }));
vi.mock("@/lib/audit/auditLogger", () => ({
  logAuditEvent: auditMock,
  AuditAction: {
    INVOICE_EMAIL_DELIVERED: "INVOICE_EMAIL_DELIVERED",
    INVOICE_EMAIL_BOUNCED: "INVOICE_EMAIL_BOUNCED",
  },
  AuditEntity: { INVOICE: "Invoice" },
}));

import { POST } from "@/app/api/webhooks/resend/route";

const baseInvoice = () => ({
  id: "inv-1",
  userId: "user-1",
  emailLog: [{ to: "client@example.test", status: "accepted", attempt: 1, messageId: "msg-1" }],
});

describe("POST /api/webhooks/resend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoiceMock.findUnique.mockResolvedValue(baseInvoice());
    invoiceMock.update.mockResolvedValue({});
  });

  it("verifies and persists a delivery event", async () => {
    verifyMock.mockReturnValue({
      type: "email.delivered",
      created_at: "2026-08-12T00:00:00.000Z",
      data: {
        email_id: "msg-1",
        to: ["client@example.test"],
        tags: { invoice_id: "inv-1" },
      },
    });

    const response = await POST(new Request("https://app.example.test/api/webhooks/resend", {
      method: "POST",
      body: JSON.stringify({ signed: true }),
      headers: {
        "svix-id": "evt-1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,test",
      },
    }));

    expect(response.status).toBe(200);
    expect(verifyMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: "evt-1" }));
    expect(invoiceMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "inv-1" },
      data: { emailLog: expect.arrayContaining([expect.objectContaining({ status: "delivered" })]) },
    }));
  });

  it("rejects an invalid signature before touching invoice data", async () => {
    verifyMock.mockImplementation(() => { throw new Error("invalid signature"); });

    const response = await POST(new Request("https://app.example.test/api/webhooks/resend", {
      method: "POST",
      body: "{}",
      headers: {
        "svix-id": "evt-invalid",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,bad",
      },
    }));

    expect(response.status).toBe(400);
    expect(invoiceMock.findUnique).not.toHaveBeenCalled();
    expect(invoiceMock.update).not.toHaveBeenCalled();
  });
});
