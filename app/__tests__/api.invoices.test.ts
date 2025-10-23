import type { Invoice, Prisma, PrismaClient } from "@prisma/client";
import { InvoiceStatus } from "@prisma/client";
import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  return { db };
});

vi.mock("@/server/auth", () => ({ authOptions: {} }));

const getServerSessionMock = vi.mocked(getServerSession);

let db: PrismaClient;

const toJson = (value: unknown): Prisma.JsonValue => value as Prisma.JsonValue;

const createInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
  id: "inv-default",
  number: "INV-DEFAULT",
  client: "Default Client",
  items: toJson([{ name: "Service", qty: 1, price: 1000 }]),
  subtotal: 1000,
  tax: 0,
  total: 1000,
  status: InvoiceStatus.DRAFT,
  issuedAt: new Date("2024-11-01T00:00:00.000Z"),
  dueAt: null,
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
  vi.setSystemTime(new Date("2024-11-15T10:00:00.000Z"));
  getServerSessionMock.mockReset();

  db.invoice.count.mockReset();
  db.invoice.create.mockReset();
  db.invoice.findMany.mockReset();
  db.invoice.aggregate.mockReset();
  db.invoice.findFirst.mockReset();
  db.invoice.update.mockReset();
  db.invoice.updateMany.mockReset();
  db.invoice.delete.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/api/invoices routes", () => {
  it("membuat invoice draft dan menghitung subtotal otomatis", async () => {
    const { POST } = await import("@/app/api/invoices/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2024-12-01T00:00:00.000Z").toISOString(),
    } as unknown as Session);

    db.invoice.count.mockResolvedValueOnce(2);

    const createdAt = new Date("2024-11-15T10:00:00.000Z");

    db.invoice.create.mockResolvedValueOnce(
      createInvoice({
        id: "inv-1",
        number: "INV-202411-003",
        client: "PT Kreatif",
        items: toJson([
          { name: "UI Design", qty: 2, price: 750_000 },
          { name: "UX Research", qty: 1, price: 500_000 },
        ]),
        subtotal: 2_000_000,
        tax: 200_000,
        total: 2_200_000,
        issuedAt: createdAt,
        dueAt: new Date("2024-11-30T00:00:00.000Z"),
        createdAt,
        updatedAt: createdAt,
      }),
    );

    const request = new Request("http://localhost/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: "PT Kreatif",
        items: [
          { name: "UI Design", qty: 2, price: 750_000 },
          { name: "UX Research", qty: 1, price: 500_000 },
        ],
        taxRate: 0.1,
        dueAt: "2024-11-30T00:00:00.000Z",
      }),
    });

    const response = await POST(request as unknown as NextRequest);

    expect(response.status).toBe(201);

    const body = await response.json();

    expect(db.invoice.count).toHaveBeenCalledWith({
      where: { number: { startsWith: "INV-202411" } },
    });

    expect(db.invoice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        client: "PT Kreatif",
        subtotal: 2_000_000,
        total: 2_200_000,
        tax: 200_000,
        status: InvoiceStatus.DRAFT,
        userId: "user-1",
      }),
    });

    expect(body.data.number).toBe("INV-202411-003");
  });

  it("memperbarui status invoice menjadi paid dan menambahkan paidAt", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2024-12-01T00:00:00.000Z").toISOString(),
    } as unknown as Session);

    db.invoice.findFirst.mockResolvedValueOnce(
      createInvoice({
        id: "inv-2",
        client: "PT Alpha",
        items: toJson([{ name: "Branding", qty: 1, price: 1_000_000 }]),
        subtotal: 1_000_000,
        tax: 100_000,
        total: 1_100_000,
        status: InvoiceStatus.SENT,
        issuedAt: new Date("2024-11-01T00:00:00.000Z"),
        dueAt: new Date("2024-11-20T00:00:00.000Z"),
      }),
    );

    const updatedInvoice = createInvoice({
      id: "inv-2",
      client: "PT Alpha",
      items: toJson([{ name: "Branding", qty: 1, price: 1_000_000 }]),
      subtotal: 1_000_000,
      tax: 100_000,
      total: 1_100_000,
      status: InvoiceStatus.PAID,
      issuedAt: new Date("2024-11-15T10:00:00.000Z"),
      dueAt: new Date("2024-11-20T00:00:00.000Z"),
      paidAt: new Date("2024-11-15T10:00:00.000Z"),
      updatedAt: new Date("2024-11-15T10:00:00.000Z"),
    });

    db.invoice.update.mockResolvedValueOnce(updatedInvoice);

    const request = new Request("http://localhost/api/invoices/inv-2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "inv-2",
        client: "PT Alpha",
        items: [{ name: "Branding", qty: 1, price: 1_000_000 }],
        subtotal: 1_000_000,
        tax: 100_000,
        total: 1_100_000,
        status: InvoiceStatus.PAID,
        issuedAt: "2024-11-01T00:00:00.000Z",
        dueAt: "2024-11-20T00:00:00.000Z",
        taxRate: 0.1,
      }),
    });

    const response = await PUT(request as unknown as NextRequest, {
      params: Promise.resolve({ id: "inv-2" }),
    });

    expect(response.status).toBe(200);

    const updatePayload = db.invoice.update.mock.calls[0][0]?.data as {
      paidAt?: Date | null;
      status?: InvoiceStatus;
    };

    expect(updatePayload.status).toBe(InvoiceStatus.PAID);
    expect(updatePayload.paidAt).toBeInstanceOf(Date);
  });

  it("menghapus invoice milik pengguna", async () => {
    const { DELETE } = await import("@/app/api/invoices/[id]/route");

    getServerSessionMock.mockResolvedValueOnce({
      user: { id: "user-1" },
      expires: new Date("2024-12-01T00:00:00.000Z").toISOString(),
    } as unknown as Session);

    db.invoice.findFirst.mockResolvedValueOnce(
      createInvoice({ id: "inv-3", number: "INV-202411-010" }),
    );

    db.invoice.delete.mockResolvedValueOnce(createInvoice({ id: "inv-3" }));

    const response = await DELETE(new Request("http://localhost/api/invoices/inv-3") as unknown as NextRequest, {
      params: Promise.resolve({ id: "inv-3" }),
    });

    expect(response.status).toBe(204);
    expect(db.invoice.delete).toHaveBeenCalledWith({ where: { id: "inv-3" } });
  });
});
