import { InvoiceStatus, type PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimiters } from "@/lib/rate-limit";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { db };
});

vi.mock("@/lib/hash", () => ({
  hash: vi.fn(async (value: string) => `hashed-${value}`),
  verify: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ authOptions: {} }));

const getServerSessionMock = vi.mocked(getServerSession);

let db: PrismaClient;

describe("Smoke tests for critical routes", () => {
  beforeAll(async () => {
    ({ db } = (await import("@/lib/db")) as unknown as { db: PrismaClient });
  });

  beforeEach(() => {
    getServerSessionMock.mockReset();
    clearRateLimiters();

    db.user.findUnique.mockReset();
    db.user.create.mockReset();
    db.invoice.findMany.mockReset();
    db.invoice.aggregate.mockReset();
    db.invoice.count.mockReset();
  });

  it("registers a new user via /api/auth/register", async () => {
    const { POST } = await import("@/app/api/auth/register/route");

    db.user.findUnique.mockResolvedValueOnce(null);
    db.user.create.mockResolvedValueOnce({
      id: "user-1",
      email: "tester@example.com",
      password: "hashed",
      name: "Tester",
    } as never);

  const request = new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Tester",
        email: "tester@example.com",
        password: "rahasia123",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
  });

  it("loads dashboard insights with 200 OK", async () => {
    const { GET } = await import("@/app/api/insight/revenue/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    } as never);

    db.invoice.findMany.mockResolvedValueOnce([
      {
        total: 500_000,
        status: InvoiceStatus.PAID,
        issuedAt: new Date("2024-09-01T00:00:00.000Z"),
        client: "PT Sukses",
        paidAt: new Date("2024-09-03T00:00:00.000Z"),
      },
    ]);

  const response = await GET(new Request("http://localhost/api/insight/revenue") as unknown as NextRequest);
    expect(response.status).toBe(200);
  });

  it("fetches invoices via /api/invoices with 200 OK", async () => {
    const { GET } = await import("@/app/api/invoices/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    } as never);

    db.invoice.findMany.mockResolvedValueOnce([]);
    db.invoice.aggregate.mockResolvedValueOnce({ _sum: { total: 0 } } as never);
    db.invoice.count.mockResolvedValueOnce(0);
    db.invoice.count.mockResolvedValueOnce(0);

  const response = await GET(new Request("http://localhost/api/invoices") as unknown as NextRequest);
    expect(response.status).toBe(200);
  });
});
