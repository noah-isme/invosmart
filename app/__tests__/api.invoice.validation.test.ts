/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import type { Invoice, Prisma, PrismaClient } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { db };
});

vi.mock("@/server/auth", () => ({ authOptions: {} }));

const getServerSessionMock = vi.mocked(getServerSession);

let db: any;

const toJson = (value: unknown): Prisma.JsonValue => value as Prisma.JsonValue;

const baseInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-test",
  number: "INV-TEST",
  client: "PT Kreatif",
  items: toJson([{ name: "Design", qty: 1, price: 500_000 }]),
  subtotal: 500_000,
  tax: 50_000,
  total: 550_000,
  status: InvoiceStatus.SENT,
  issuedAt: new Date("2024-11-01T00:00:00.000Z"),
  dueAt: new Date("2024-11-15T00:00:00.000Z"),
  paidAt: null,
  notes: null,
  userId: "user-1",
  createdAt: new Date("2024-11-01T00:00:00.000Z"),
  updatedAt: new Date("2024-11-01T00:00:00.000Z"),
  ...overrides,
});

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-11-20T00:00:00.000Z"));

  getServerSessionMock.mockReset();
  getServerSessionMock.mockResolvedValue({
    user: { id: "user-1" },
    expires: new Date("2024-12-01T00:00:00.000Z").toISOString(),
  } as unknown as Session);

  db.invoice.create.mockReset();
  db.invoice.findFirst.mockReset();
  db.invoice.update.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Invoice API validation", () => {
  it("menolak payload POST tanpa item", async () => {
    const { POST } = await import("@/app/api/invoices/route");

    const request = new Request("http://localhost/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: "",
        items: [],
        taxRate: 0.1,
        dueAt: null,
      }),
    });

    const response = await POST(request as unknown as NextRequest);

    expect(response.status).toBe(400);
    expect(db.invoice.create).not.toHaveBeenCalled();
  });

  it("mengembalikan 400 jika subtotal tidak sesuai hasil kalkulasi", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");

    db.invoice.findFirst.mockResolvedValueOnce(baseInvoice());

    const request = new Request("http://localhost/api/invoices/inv-test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "inv-test",
        client: "PT Kreatif",
        items: [{ name: "Design", qty: 1, price: 500_000 }],
        subtotal: 400_000,
        tax: 0,
        total: 400_000,
        status: InvoiceStatus.PAID,
        issuedAt: "2024-11-01T00:00:00.000Z",
        dueAt: "2024-11-15T00:00:00.000Z",
        taxRate: 0.1,
      }),
    });

    const response = await PUT(request as unknown as NextRequest, {
      params: Promise.resolve({ id: "inv-test" }),
    });

    expect(response.status).toBe(400);
    expect(db.invoice.update).not.toHaveBeenCalled();
  });

  it("menerima pembaruan ketika subtotal dan total valid", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");

    db.invoice.findFirst.mockResolvedValueOnce(baseInvoice());
    db.invoice.update.mockResolvedValueOnce(baseInvoice({ status: InvoiceStatus.PAID }));

    const request = new Request("http://localhost/api/invoices/inv-test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "inv-test",
        client: "PT Kreatif",
        items: [{ name: "Design", qty: 1, price: 500_000 }],
        subtotal: 500_000,
        tax: 50_000,
        total: 550_000,
        status: InvoiceStatus.PAID,
        issuedAt: "2024-11-01T00:00:00.000Z",
        dueAt: "2024-11-15T00:00:00.000Z",
        taxRate: 0.1,
      }),
    });

    const response = await PUT(request as unknown as NextRequest, {
      params: Promise.resolve({ id: "inv-test" }),
    });

    expect(response.status).toBe(200);
    expect(db.invoice.update).toHaveBeenCalled();
  });
});
