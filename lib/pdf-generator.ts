import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Invoice, User } from "@prisma/client";

const DEFAULT_PRIMARY_COLOR = "#6366f1"; // indigo-500
const FONT_MAP = {
  sans: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
  },
  serif: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
  },
  mono: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
  },
} as const;

type SupportedFont = keyof typeof FONT_MAP;

const isHexColor = (value: string): boolean => /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim());

const hexToRgb = (hex: string): RGB => {
  const normalized = hex.trim().toLowerCase();
  const value = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;

  const r = parseInt(value.slice(1, 3), 16) / 255;
  const g = parseInt(value.slice(3, 5), 16) / 255;
  const b = parseInt(value.slice(5, 7), 16) / 255;

  return rgb(r, g, b);
};

type InvoiceItem = { name: string; qty: number; price: number };

const resolveItems = (raw: Invoice["items"]): InvoiceItem[] => {
  if (Array.isArray(raw)) {
    return raw as InvoiceItem[];
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as InvoiceItem[];
      }
    } catch {
      // Ignore malformed JSON and fall through to default.
    }
  }

  return [];
};

const resolveFontChoice = (fontFamily: User["fontFamily"]): SupportedFont => {
  if (!fontFamily) {
    return "sans";
  }

  if (fontFamily === "serif" || fontFamily === "mono") {
    return fontFamily;
  }

  return "sans";
};

const resolvePrimaryColor = (primaryColor: User["primaryColor"]): RGB => {
  if (typeof primaryColor === "string" && isHexColor(primaryColor)) {
    return hexToRgb(primaryColor);
  }

  return hexToRgb(DEFAULT_PRIMARY_COLOR);
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

const drawHeader = async (
  page: PDFPage,
  pdf: PDFDocument,
  user: User,
  fonts: { regular: PDFFont; bold: PDFFont },
  accent: RGB,
) => {
  const { width, height } = page.getSize();
  const margin = 50;

  page.drawText(user.name ?? "InvoSmart User", {
    x: margin,
    y: height - margin - 10,
    size: 22,
    font: fonts.bold,
    color: accent,
  });

  const contactLine = user.email ? `Email: ${user.email}` : "Invoice by InvoSmart";
  page.drawText(contactLine, {
    x: margin,
    y: height - margin - 35,
    size: 10,
    font: fonts.regular,
    color: rgb(0.45, 0.45, 0.5),
  });

  const addressLine = user.primaryColor ? "Branding aktif" : "Branding default";
  page.drawText(addressLine, {
    x: margin,
    y: height - margin - 50,
    size: 10,
    font: fonts.regular,
    color: rgb(0.45, 0.45, 0.5),
  });

  if (user.logoUrl) {
    try {
      const response = await fetch(user.logoUrl);
      if (response.ok) {
        const bytes = await response.arrayBuffer();
        let image;

        const signature = new Uint8Array(bytes, 0, 4);
        const isPng = signature[0] === 0x89 && signature[1] === 0x50 && signature[2] === 0x4e && signature[3] === 0x47;

        if (isPng) {
          image = await pdf.embedPng(bytes);
        } else {
          image = await pdf.embedJpg(bytes);
        }

        const logoWidth = 96;
        const aspect = image.height / image.width;
        const logoHeight = logoWidth * aspect;

        page.drawImage(image, {
          x: width - margin - logoWidth,
          y: height - margin - logoHeight,
          width: logoWidth,
          height: logoHeight,
        });
      }
    } catch {
      // Ignore logo rendering failures to keep PDF generation resilient.
    }
  }

  page.drawLine({
    start: { x: margin, y: height - margin - 70 },
    end: { x: width - margin, y: height - margin - 70 },
    thickness: 1.2,
    color: accent,
  });
};

const drawInvoiceMeta = (
  page: PDFPage,
  invoice: Invoice,
  fonts: { regular: PDFFont; bold: PDFFont },
  accent: RGB,
) => {
  const { height } = page.getSize();
  const margin = 50;

  page.drawText(`Invoice #${invoice.number}`, {
    x: margin,
    y: height - margin - 95,
    size: 14,
    font: fonts.bold,
    color: accent,
  });

  page.drawText(`Klien: ${invoice.client}`, {
    x: margin,
    y: height - margin - 115,
    size: 11,
    font: fonts.regular,
    color: rgb(0.25, 0.25, 0.3),
  });

  const issuedAt = new Date(invoice.issuedAt);
  const dueAt = invoice.dueAt ? new Date(invoice.dueAt) : null;
  const formatDate = (date: Date | null) =>
    date && !Number.isNaN(date.getTime())
      ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date)
      : "-";

  page.drawText(`Diterbitkan: ${formatDate(issuedAt)}`, {
    x: margin,
    y: height - margin - 135,
    size: 11,
    font: fonts.regular,
    color: rgb(0.25, 0.25, 0.3),
  });

  page.drawText(`Jatuh tempo: ${formatDate(dueAt)}`, {
    x: margin,
    y: height - margin - 150,
    size: 11,
    font: fonts.regular,
    color: rgb(0.25, 0.25, 0.3),
  });
};

const drawItemsTable = (
  page: PDFPage,
  items: InvoiceItem[],
  fonts: { regular: PDFFont; bold: PDFFont },
  accent: RGB,
) => {
  const { width } = page.getSize();
  const margin = 50;
  let y = page.getHeight() - margin - 190;
  const columnX = [margin, margin + 260, margin + 330, width - margin - 80];

  page.drawRectangle({
    x: margin,
    y: y - 6,
    width: width - margin * 2,
    height: 26,
    color: accent,
    opacity: 0.08,
  });

  const headers = ["Item", "Qty", "Harga", "Jumlah"];
  headers.forEach((header, index) => {
    page.drawText(header, {
      x: columnX[index],
      y: y,
      size: 11,
      font: fonts.bold,
      color: accent,
    });
  });

  y -= 24;

  items.forEach((item) => {
    const rowHeight = 18;
    page.drawText(item.name, {
      x: columnX[0],
      y,
      size: 10,
      font: fonts.regular,
      color: rgb(0.15, 0.15, 0.2),
    });

    page.drawText(String(item.qty), {
      x: columnX[1],
      y,
      size: 10,
      font: fonts.regular,
      color: rgb(0.15, 0.15, 0.2),
    });

    page.drawText(formatCurrency(item.price), {
      x: columnX[2],
      y,
      size: 10,
      font: fonts.regular,
      color: rgb(0.15, 0.15, 0.2),
    });

    page.drawText(formatCurrency(item.qty * item.price), {
      x: columnX[3],
      y,
      size: 10,
      font: fonts.regular,
      color: rgb(0.15, 0.15, 0.2),
    });

    y -= rowHeight;
  });

  return y;
};

const drawTotals = (
  page: PDFPage,
  invoice: Invoice,
  fonts: { regular: PDFFont; bold: PDFFont },
  accent: RGB,
  startY: number,
) => {
  const margin = 50;
  let y = startY - 10;

  const entries: Array<[string, number, boolean]> = [
    ["Subtotal", invoice.subtotal, false],
    ["Pajak", invoice.tax, false],
    ["Total", invoice.total, true],
  ];

  entries.forEach(([label, amount, highlight]) => {
    page.drawText(label, {
      x: page.getWidth() - margin - 200,
      y,
      size: highlight ? 12 : 11,
      font: highlight ? fonts.bold : fonts.regular,
      color: highlight ? accent : rgb(0.25, 0.25, 0.3),
    });

    page.drawText(formatCurrency(amount), {
      x: page.getWidth() - margin - 80,
      y,
      size: highlight ? 12 : 11,
      font: highlight ? fonts.bold : fonts.regular,
      color: highlight ? accent : rgb(0.25, 0.25, 0.3),
    });

    y -= 18;
  });
};

const drawFooter = (
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
) => {
  const { width } = page.getSize();
  const margin = 50;

  const printedAt = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const footerColor = rgb(0.55, 0.55, 0.6);

  page.drawText(`Dicetak: ${printedAt}`, {
    x: margin,
    y: 40,
    size: 10,
    font: fonts.regular,
    color: footerColor,
  });

  page.drawText("InvoSmart", {
    x: width - margin - 60,
    y: 40,
    size: 10,
    font: fonts.bold,
    color: footerColor,
  });

  page.drawText("InvoSmart", {
    x: width / 2 - 40,
    y: 200,
    size: 48,
    font: fonts.bold,
    color: rgb(0.8, 0.8, 0.85),
    rotate: degrees(45),
    opacity: 0.05,
  });
};

export async function generateInvoicePDF(invoice: Invoice, user: User) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);

  const fontChoice = resolveFontChoice(user.fontFamily);
  const fonts = {
    regular: await pdf.embedFont(FONT_MAP[fontChoice].regular),
    bold: await pdf.embedFont(FONT_MAP[fontChoice].bold),
  };

  const accent = resolvePrimaryColor(user.primaryColor);
  const items = resolveItems(invoice.items);

  await drawHeader(page, pdf, user, fonts, accent);
  drawInvoiceMeta(page, invoice, fonts, accent);
  const afterTableY = drawItemsTable(page, items, fonts, accent);
  drawTotals(page, invoice, fonts, accent, afterTableY);
  drawFooter(page, fonts);

  return pdf.save();
}
