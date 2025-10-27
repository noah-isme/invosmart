import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateInvoicePDF } from "@/lib/pdf-generator";

type InvoiceRecord = Parameters<typeof generateInvoicePDF>[0];
type UserRecord = Parameters<typeof generateInvoicePDF>[1];

const createInvoice = (): InvoiceRecord => ({
  ...( { id: "inv-001" } as unknown as Record<string, unknown> ),
  number: "INV-2024-001",
  client: "PT Kreatif Maju",
  items: [
    { name: "UI/UX Design", qty: 1, price: 4_500_000 },
    { name: "Development", qty: 2, price: 3_250_000 },
  ] as unknown as InvoiceRecord["items"],
  subtotal: 11_000_000,
  tax: 1_100_000,
  total: 12_100_000,
  status: "SENT",
  issuedAt: new Date("2024-10-01T00:00:00.000Z"),
  dueAt: new Date("2024-10-15T00:00:00.000Z"),
  paidAt: null,
  notes: null,
  userId: "user-123",
  createdAt: new Date("2024-10-01T00:00:00.000Z"),
  updatedAt: new Date("2024-10-01T00:00:00.000Z"),
});

const createUser = (): UserRecord => ({
  email: "studio@invosmart.dev",
  name: "Studio InvoSmart",
  logoUrl: null,
  primaryColor: "#0ea5e9",
  fontFamily: "serif",
  themePrimary: "#6366f1",
  themeAccent: "#22d3ee",
  useThemeForPdf: false,
});

describe("generateInvoicePDF", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network disabled"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("menghasilkan PDF valid dengan ukuran wajar", async () => {
    const pdfBytes = await generateInvoicePDF(createInvoice(), createUser());

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    const prefix = Buffer.from(pdfBytes).toString("utf8", 0, 4);
    expect(prefix).toBe("%PDF");
    expect(pdfBytes.byteLength).toBeLessThan(1_000_000);
  });
});
