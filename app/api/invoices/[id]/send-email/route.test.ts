import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoiceMock, sendMock, sessionMock, renderMock, auditMock } = vi.hoisted(() => ({
  invoiceMock: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  sendMock: vi.fn(),
  sessionMock: vi.fn(),
  renderMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { invoice: invoiceMock } }));
vi.mock("@/lib/email/resend", () => ({ resend: { emails: { send: sendMock } } }));
vi.mock("next-auth", () => ({ getServerSession: sessionMock }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@react-email/render", () => ({ render: renderMock }));
vi.mock("@/lib/audit/auditLogger", () => ({
  logAuditEvent: auditMock,
  AuditAction: { INVOICE_EMAIL_ACCEPTED: "INVOICE_EMAIL_ACCEPTED", INVOICE_EMAIL_FAILED: "INVOICE_EMAIL_FAILED" },
  AuditEntity: { INVOICE: "Invoice" },
}));
vi.mock("@/lib/security", () => ({ enforceHttps: vi.fn(() => null) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(() => null) }));

import { POST } from "@/app/api/invoices/[id]/send-email/route";

const invoice = () => ({
  id: "inv-1",
  number: "INV-001",
  client: "Client",
  items: [],
  subtotal: 100,
  tax: 0,
  total: 100,
  currency: "IDR",
  dueAt: null,
  notes: null,
  status: "DRAFT",
  emailedAt: null,
  emailLog: null,
  userId: "user-1",
  user: { name: "Issuer" },
  client_rel: { name: "Client", email: "client@example.test" },
});

describe("POST /api/invoices/[id]/send-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
    sessionMock.mockResolvedValue({ user: { id: "user-1" } });
    invoiceMock.findUnique.mockResolvedValue(invoice());
    invoiceMock.update.mockResolvedValue({});
    renderMock.mockResolvedValue("<html>invoice</html>");
  });

  it("marks a draft SENT only after Resend returns a provider message id", async () => {
    sendMock.mockResolvedValue({ data: { id: "msg-1" }, error: null });

    const response = await POST(
      new Request("https://app.example.test/api/invoices/inv-1/send-email", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "inv-1" }) },
    );

    expect(response.status).toBe(200);
    expect(invoiceMock.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENT" }),
    }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      tags: expect.arrayContaining([{ name: "invoice_id", value: "inv-1" }]),
    }), expect.objectContaining({ idempotencyKey: expect.stringContaining("inv-1") }));
  });

  it("does not mark a draft SENT when provider rejects the message", async () => {
    sendMock.mockResolvedValue({ error: { statusCode: 400, message: "invalid recipient" }, data: null });

    const response = await POST(
      new Request("https://app.example.test/api/invoices/inv-1/send-email", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: "inv-1" }) },
    );

    expect(response.status).toBe(502);
    expect(invoiceMock.update).toHaveBeenCalledTimes(1);
    expect(invoiceMock.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });
});
