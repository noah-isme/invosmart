import { NextRequest } from "next/server";
import { describe, expect, it, beforeEach, vi } from "vitest";

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

describe("POST /api/invoices/ai", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    createMock.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "";
  });

  it("mengembalikan draft invoice ketika respons AI valid", async () => {
    const { POST } = await import("@/app/api/invoices/ai/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              client: "PT Kreatif Digital",
              items: [{ name: "Desain Logo", qty: 1, price: 2_000_000 }],
              dueAt: "2024-06-01T00:00:00.000Z",
              notes: "Pembayaran 14 hari setelah invoice diterima.",
            }),
          },
        },
      ],
    });

    const request = new Request("http://localhost/api/invoices/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Buat invoice desain logo" }),
    });

    const response = await POST(request as unknown as NextRequest);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toMatchObject({
      client: "PT Kreatif Digital",
      items: [{ name: "Desain Logo", qty: 1, price: 2_000_000 }],
      dueAt: "2024-06-01T00:00:00.000Z",
      notes: "Pembayaran 14 hari setelah invoice diterima.",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("mengembalikan fallback dan status 400 ketika respons AI tidak valid", async () => {
    const { POST } = await import("@/app/api/invoices/ai/route");

    getServerSessionMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "Tidak ada JSON yang valid",
          },
        },
      ],
    });

    const request = new Request("http://localhost/api/invoices/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Buat invoice" }),
    });

    const response = await POST(request as unknown as NextRequest);

    expect(response.status).toBe(400);
    const body = await response.json();

    expect(body.error).toBe("Invalid AI response");
    expect(body.fallback).toMatchObject({
      client: "",
      items: [{ name: "", qty: 1, price: 0 }],
      notes: "",
    });
  });
});

