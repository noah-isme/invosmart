import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/pdf-generator", () => ({
  generateInvoicePDF: vi.fn(),
}));

import { GET } from "@/app/api/invoices/[id]/pdf/route";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { generateInvoicePDF } from "@/lib/pdf-generator";
import { getServerSession } from "next-auth";

type InvoiceRecord = Parameters<typeof generateInvoicePDF>[0];
type UserRecord = Parameters<typeof generateInvoicePDF>[1];

describe("GET /api/invoices/[id]/pdf", () => {
  const mockSession = getServerSession as unknown as Mock;
  const mockGenerator = generateInvoicePDF as unknown as Mock;
  const params = { params: Promise.resolve({ id: "inv-1" }) } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockReset();
    mockGenerator.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mengembalikan PDF saat authorized", async () => {
    mockSession.mockResolvedValue({ user: { id: "user-1", email: "studio@invosmart.dev" } });

  const invoice: unknown = {
      id: "inv-1",
      number: "INV-2024-001",
      client: "PT Kreatif",
      items: [{ name: "Design", qty: 1, price: 1_000_000 }] as unknown as InvoiceRecord["items"],
      subtotal: 1_000_000,
      tax: 100_000,
      total: 1_100_000,
      status: "SENT",
      issuedAt: new Date().toISOString(),
      dueAt: new Date().toISOString(),
      paidAt: null,
      notes: null,
      userId: "user-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
  } as unknown as InvoiceRecord;

  const user: unknown = {
      id: "user-1",
      email: "studio@invosmart.dev",
      name: "Studio",
      logoUrl: null,
      primaryColor: "#6366f1",
      fontFamily: "sans",
      password: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
  } as unknown as UserRecord;

  vi.spyOn(db.invoice, "findFirst").mockResolvedValue(invoice as unknown as InvoiceRecord);
  vi.spyOn(db.user, "findUnique").mockResolvedValue(user as unknown as UserRecord);

    const pdfBytes = Uint8Array.from([37, 80, 68, 70, 10]);
    mockGenerator.mockResolvedValue(pdfBytes);

  const response = await GET(new Request("http://localhost") as unknown as NextRequest, params as unknown as Parameters<typeof GET>[1]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const buffer = await response.arrayBuffer();
    expect(Array.from(new Uint8Array(buffer).slice(0, 4))).toEqual([37, 80, 68, 70]);
    expect(mockGenerator).toHaveBeenCalledTimes(1);
  });

  it("mengembalikan 401 saat belum login", async () => {
    mockSession.mockResolvedValue(null);

  const response = await GET(new Request("http://localhost") as unknown as NextRequest, params as unknown as Parameters<typeof GET>[1]);

    expect(response.status).toBe(401);
  });
});
