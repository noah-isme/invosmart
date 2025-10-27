import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSessionMock = vi.fn();
const createMock = vi.fn();

vi.mock("next-auth", () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}));

vi.mock("@/server/auth", () => ({ authOptions: {} }));

vi.mock("openai", () => ({
  __esModule: true,
  default: vi.fn(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
  })),
}));

const summary = {
  totals: {
    revenue: 45_000_000,
    paidInvoices: 12,
    overdueInvoices: 2,
    outstandingInvoices: 3,
    averageInvoice: 3_750_000,
  },
  monthlyRevenue: [
    { month: "Jul", revenue: 12_000_000, paid: 3, overdue: 1 },
    { month: "Aug", revenue: 9_000_000, paid: 2, overdue: 0 },
    { month: "Sep", revenue: 11_000_000, paid: 3, overdue: 1 },
    { month: "Oct", revenue: 13_000_000, paid: 4, overdue: 0 },
  ],
  topClients: [
    { client: "PT Nusantara Digital", revenue: 18_000_000, paidInvoices: 5, overdueInvoices: 0 },
    { client: "PT Samudra", revenue: 11_000_000, paidInvoices: 3, overdueInvoices: 1 },
  ],
  recentInvoices: [
    { client: "PT Nusantara Digital", total: 4_500_000, status: "PAID", issuedAt: "2024-10-10T00:00:00.000Z" },
  ],
  period: {
    label: "Jul – Oct",
    months: ["Jul", "Aug", "Sep", "Oct"],
    currency: "IDR",
  },
  trend: {
    lastMonth: 13_000_000,
    previousMonth: 11_000_000,
  },
};

describe("POST /api/ai/invoice-insight", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    createMock.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "";
  });

  it("returns AI insight when OpenAI responds with valid payload", async () => {
    const { POST } = await import("@/app/api/ai/invoice-insight/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              totalRevenue: "Rp 45.000.000",
              topClient: "PT Nusantara Digital",
              insight: "Pendapatan naik 12% berkat klien baru di hospitality.",
              recommendation: "Pertahankan performa klien utama dan siapkan paket loyalitas.",
            }),
          },
        },
      ],
    });

    const request = new Request("http://localhost/api/ai/invoice-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
    });

    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.topClient).toBe("PT Nusantara Digital");
    expect(body.fallback).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns fallback insight when OpenAI fails", async () => {
    const { POST } = await import("@/app/api/ai/invoice-insight/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    createMock.mockRejectedValueOnce(new Error("Service unavailable"));

    const request = new Request("http://localhost/api/ai/invoice-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(summary),
    });

    const response = await POST(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.fallback).toBe(true);
    expect(body.data).toMatchObject({ topClient: "PT Nusantara Digital" });
  });
});
