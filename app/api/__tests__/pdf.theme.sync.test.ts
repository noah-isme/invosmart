import { beforeEach, describe, expect, it, vi } from "vitest";

const drawRectangleMock = vi.fn();
const drawLineMock = vi.fn();
const drawTextMock = vi.fn();
const fontStub = {
  widthOfTextAtSize: vi.fn().mockReturnValue(40),
};
const embedFontMock = vi.fn().mockResolvedValue(fontStub);
const saveMock = vi.fn().mockResolvedValue(new Uint8Array());

const pageMock = {
  getSize: () => ({ width: 600, height: 800 }),
  getWidth: () => 600,
  getHeight: () => 800,
  drawRectangle: drawRectangleMock,
  drawLine: drawLineMock,
  drawText: drawTextMock,
};

const addPageMock = vi.fn(() => pageMock);

vi.mock("pdf-lib", () => ({
  degrees: vi.fn(),
  rgb: (r: number, g: number, b: number) => ({ r, g, b }),
  PDFDocument: {
    create: vi.fn(async () => ({ addPage: addPageMock, embedFont: embedFontMock, save: saveMock })),
  },
  StandardFonts: {
    Helvetica: "Helvetica",
    HelveticaBold: "HelveticaBold",
    TimesRoman: "TimesRoman",
    TimesRomanBold: "TimesRomanBold",
    Courier: "Courier",
    CourierBold: "CourierBold",
  },
}));

describe("generateInvoicePDF", () => {
  beforeEach(() => {
    drawRectangleMock.mockReset();
    drawLineMock.mockReset();
    drawTextMock.mockReset();
    embedFontMock.mockClear();
    saveMock.mockClear();
    addPageMock.mockClear();
  });

  it("menggunakan warna tema ketika sinkronisasi PDF aktif", async () => {
    const invoice = {
      id: "inv-1",
      number: "INV-001",
      client: "Acme",
      items: JSON.stringify([{ name: "Design", qty: 1, price: 1000 }]),
      subtotal: 1000,
      tax: 0,
      total: 1000,
      status: "PAID",
      issuedAt: new Date().toISOString(),
      dueAt: null,
      paidAt: null,
      notes: null,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as const;

    const user = {
      id: "user-1",
      email: "owner@acme.test",
      name: "Acme",
      logoUrl: null,
      primaryColor: "#ff8800",
      fontFamily: "sans",
      brandingSyncWithTheme: true,
      useThemeForPdf: true,
      themePrimary: "#112233",
      themeAccent: "#445566",
      themeMode: "dark",
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as const;

    const { generateInvoicePDF } = await import("@/lib/pdf-generator");
    type InvoiceInput = Parameters<typeof generateInvoicePDF>[0];
    type UserInput = Parameters<typeof generateInvoicePDF>[1];

    await generateInvoicePDF(invoice as InvoiceInput, user as UserInput);

    const headerCall = drawRectangleMock.mock.calls[0]?.[0];
    const accentCall = drawRectangleMock.mock.calls[1]?.[0];
    const footerLine = drawLineMock.mock.calls.find((call) => call[0]?.start?.y === 80)?.[0];

    expect(headerCall?.color).toEqual({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 });
    expect(accentCall?.color).toEqual({ r: 0x44 / 255, g: 0x55 / 255, b: 0x66 / 255 });
    expect(footerLine?.color).toEqual({ r: 0x11 / 255, g: 0x22 / 255, b: 0x33 / 255 });
  });
});
