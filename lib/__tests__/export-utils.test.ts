import { describe, expect, it } from "vitest";

import {
  escapeCSVCell,
  escapeXml,
  exportToCSV,
  exportToXLSX,
  formatDateForExport,
  generateCSV,
  generateXLSX,
  type InvoiceExportData,
} from "../export-utils";

describe("export-utils", () => {
  describe("escapeCSVCell", () => {
    it("returns plain string unchanged", () => {
      expect(escapeCSVCell("INV-001")).toBe("INV-001");
      expect(escapeCSVCell("PAID")).toBe("PAID");
    });

    it("wraps string with commas in double quotes", () => {
      expect(escapeCSVCell("Acme, Inc.")).toBe('"Acme, Inc."');
    });

    it("doubles existing double quotes and wraps in double quotes", () => {
      expect(escapeCSVCell('Company "Special" Ltd')).toBe(
        '"Company ""Special"" Ltd"',
      );
    });

    it("wraps strings containing line breaks", () => {
      expect(escapeCSVCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCSVCell("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });

    it("handles null, undefined, and numbers", () => {
      expect(escapeCSVCell(null)).toBe("");
      expect(escapeCSVCell(undefined)).toBe("");
      expect(escapeCSVCell(1500000)).toBe("1500000");
    });
  });

  describe("formatDateForExport", () => {
    it("formats Date objects into YYYY-MM-DD", () => {
      const date = new Date("2026-08-15T12:00:00.000Z");
      expect(formatDateForExport(date)).toBe("2026-08-15");
    });

    it("formats ISO string into YYYY-MM-DD", () => {
      expect(formatDateForExport("2026-08-15T00:00:00.000Z")).toBe("2026-08-15");
      expect(formatDateForExport("2026-08-15")).toBe("2026-08-15");
    });

    it("returns empty string for null or undefined", () => {
      expect(formatDateForExport(null)).toBe("");
      expect(formatDateForExport(undefined)).toBe("");
    });
  });

  describe("escapeXml", () => {
    it("escapes XML special characters", () => {
      expect(escapeXml("ACME & Sons <Tech> 'Quotes' & \"More\"")).toBe(
        "ACME &amp; Sons &lt;Tech&gt; &apos;Quotes&apos; &amp; &quot;More&quot;",
      );
    });

    it("returns empty string for null or undefined", () => {
      expect(escapeXml(null)).toBe("");
      expect(escapeXml(undefined)).toBe("");
    });
  });

  describe("exportToCSV", () => {
    const sampleData: InvoiceExportData[] = [
      {
        number: "INV-202608-001",
        client: "Acme, Inc.",
        status: "PAID",
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-15T00:00:00.000Z",
        total: 1500000,
        currency: "IDR",
      },
      {
        number: 'INV-202608-002',
        client: 'Global "Tech" Co',
        status: "UNPAID",
        issuedAt: new Date("2026-08-02T00:00:00.000Z"),
        dueAt: null,
        total: 2500,
        currency: "USD",
      },
    ];

    it("generates RFC 4180 compliant CSV string with 7 required columns", () => {
      const csv = exportToCSV(sampleData);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe(
        "Invoice Number,Client Name,Status,Issued Date,Due Date,Total,Currency",
      );

      expect(lines[1]).toBe(
        'INV-202608-001,"Acme, Inc.",PAID,2026-08-01,2026-08-15,1500000,IDR',
      );

      expect(lines[2]).toBe(
        'INV-202608-002,"Global ""Tech"" Co",UNPAID,2026-08-02,,2500,USD',
      );
    });

    it("alias generateCSV produces identical output", () => {
      expect(generateCSV(sampleData)).toBe(exportToCSV(sampleData));
    });
  });

  describe("exportToXLSX", () => {
    const sampleData: InvoiceExportData[] = [
      {
        number: "INV-202608-001",
        client: "Acme & Co",
        status: "PAID",
        issuedAt: "2026-08-01T00:00:00.000Z",
        dueAt: "2026-08-15T00:00:00.000Z",
        total: 1500000,
        currency: "IDR",
      },
    ];

    it("generates SpreadsheetML XML document with required headers and data rows", () => {
      const xml = exportToXLSX(sampleData);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-microsoft-com:office:spreadsheet"');
      expect(xml).toContain('<Worksheet ss:Name="Invoices">');

      expect(xml).toContain('<Data ss:Type="String">Invoice Number</Data>');
      expect(xml).toContain('<Data ss:Type="String">Client Name</Data>');
      expect(xml).toContain('<Data ss:Type="String">Status</Data>');
      expect(xml).toContain('<Data ss:Type="String">Issued Date</Data>');
      expect(xml).toContain('<Data ss:Type="String">Due Date</Data>');
      expect(xml).toContain('<Data ss:Type="String">Total</Data>');
      expect(xml).toContain('<Data ss:Type="String">Currency</Data>');

      expect(xml).toContain('<Data ss:Type="String">INV-202608-001</Data>');
      expect(xml).toContain('<Data ss:Type="String">Acme &amp; Co</Data>');
      expect(xml).toContain('<Data ss:Type="Number">1500000</Data>');
    });

    it("alias generateXLSX produces identical output", () => {
      expect(generateXLSX(sampleData)).toBe(exportToXLSX(sampleData));
    });
  });
});
