import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { sessionMock, findFirstMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  findFirstMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: sessionMock }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { paymentAttempt: { findFirst: findFirstMock } } }));

import { GET } from "@/app/api/payments/[attemptId]/route";

describe("GET /api/payments/[attemptId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("requires authentication", async () => {
    sessionMock.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/payments/a"), {
      params: Promise.resolve({ attemptId: "a" }),
    });
    expect(response.status).toBe(401);
  });

  it("does not reveal an attempt owned by another user", async () => {
    findFirstMock.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/payments/a"), {
      params: Promise.resolve({ attemptId: "a" }),
    });
    expect(response.status).toBe(404);
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "a", invoice: { userId: "user-1" } },
    }));
  });

  it("returns a provider-neutral status payload", async () => {
    findFirstMock.mockResolvedValue({
      id: "a",
      provider: "midtrans",
      providerOrderId: "invo_a",
      providerSessionId: null,
      providerPaymentId: "txn-1",
      checkoutUrl: "https://pay.example/a",
      amount: 1000,
      currency: "IDR",
      status: "SETTLED",
      expiresAt: new Date("2026-08-12T12:00:00.000Z"),
      createdAt: new Date("2026-08-12T11:00:00.000Z"),
      updatedAt: new Date("2026-08-12T11:01:00.000Z"),
      invoice: { id: "inv-1", number: "INV-1", status: "PAID" },
      payments: [{
        id: "payment-1",
        paidAmount: 1000,
        refundedAmount: 0,
        paidCurrency: "IDR",
        paidAt: new Date("2026-08-12T11:01:00.000Z"),
        gatewayStatus: "settlement",
      }],
    });

    const response = await GET(new NextRequest("http://localhost/api/payments/a"), {
      params: Promise.resolve({ attemptId: "a" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      attemptId: "a",
      status: "SETTLED",
      invoice: { id: "inv-1", status: "PAID" },
      payments: [{ paidAt: "2026-08-12T11:01:00.000Z" }],
    });
  });
});
