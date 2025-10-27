/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { InvoiceStatus, type PrismaClient } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimiters } from "@/lib/rate-limit";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { db };
});

vi.mock("@/server/auth", () => ({ authOptions: {} }));

const getServerSessionMock = vi.mocked(getServerSession);

let db: any;

describe("GET /api/insight/revenue", () => {
  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-11-20T10:00:00.000Z"));
    getServerSessionMock.mockReset();
    clearRateLimiters();

    db.invoice.findMany.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns aggregated revenue insight for the last six months", async () => {
    const { GET } = await import("@/app/api/insight/revenue/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    } as never);

    db.invoice.findMany.mockResolvedValueOnce([
      {
        total: 1_000_000,
        status: InvoiceStatus.PAID,
        issuedAt: new Date("2024-06-05T00:00:00.000Z"),
        client: "PT Nusantara",
        paidAt: new Date("2024-06-07T00:00:00.000Z"),
      },
      {
        total: 2_000_000,
        status: InvoiceStatus.PAID,
        issuedAt: new Date("2024-07-10T00:00:00.000Z"),
        client: "PT Samudra",
        paidAt: new Date("2024-07-20T00:00:00.000Z"),
      },
      {
        total: 1_500_000,
        status: InvoiceStatus.OVERDUE,
        issuedAt: new Date("2024-08-01T00:00:00.000Z"),
        client: "PT Garuda",
        paidAt: null,
      },
      {
        total: 1_800_000,
        status: InvoiceStatus.PAID,
        issuedAt: new Date("2024-09-05T00:00:00.000Z"),
        client: "PT Nusantara",
        paidAt: new Date("2024-09-07T00:00:00.000Z"),
      },
    ]);

    const request = new Request("http://localhost/api/insight/revenue");

    const response = await GET(request as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.months).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(body.revenue).toEqual([1_000_000, 2_000_000, 0, 1_800_000, 0, 0]);
    expect(body.paid).toEqual([1, 1, 0, 1, 0, 0]);
    expect(body.overdue).toEqual([0, 0, 1, 0, 0, 0]);
    expect(body.topClient).toEqual({ client: "PT Nusantara", averageDays: 2 });
    expect(body.overdueClients).toEqual(["PT Garuda"]);
  });
});
