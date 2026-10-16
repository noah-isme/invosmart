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

    it("prefixes formula-like strings with a single quote (CSV injection)", () => {
      expect(escapeCSVCell("=1+1")).toBe("'=1+1");
      expect(escapeCSVCell("+62 811 0000 0001")).toBe("'+62 811 0000 0001");
      expect(escapeCSVCell("-Diskon")).toBe("'-Diskon");
      expect(escapeCSVCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
      expect(escapeCSVCell("\tTab Co")).toBe("'\tTab Co");
      // CR is also a line break, so the prefixed value is quoted as well.
      expect(escapeCSVCell("\r=cmd")).toBe("\"'\r=cmd\"");
      // Prefix first, then RFC 4180 quoting.
      expect(escapeCSVCell('=HYPERLINK("http://evil.example","x")')).toBe(
        '"\'=HYPERLINK(""http://evil.example"",""x"")"',
      );
    });

    it("prefixes formula-like strings that hide the trigger behind leading whitespace", () => {
      expect(escapeCSVCell(" =1+1")).toBe("' =1+1");
      expect(escapeCSVCell("  -Diskon")).toBe("'  -Diskon");
      expect(escapeCSVCell("\u00a0@SUM(A1:A9)")).toBe("'\u00a0@SUM(A1:A9)");
      expect(escapeCSVCell("\u00a0 +62 811")).toBe("'\u00a0 +62 811");
      expect(escapeCSVCell(' =HYPERLINK("http://evil.example","x")')).toBe(
        '"\' =HYPERLINK(""http://evil.example"",""x"")"',
      );
      // Whitespace before a harmless character stays untouched, and numbers stay numbers.
      expect(escapeCSVCell(" PT Maju")).toBe(" PT Maju");
      expect(escapeCSVCell("\u00a0Acme = Jaya")).toBe("\u00a0Acme = Jaya");
      expect(escapeCSVCell(-250000)).toBe("-250000");
    });

    it("leaves numbers (including negative amounts) and inner formula characters alone", () => {
      expect(escapeCSVCell(-250000)).toBe("-250000");
      expect(escapeCSVCell(0)).toBe("0");
      expect(escapeCSVCell("PT Maju = Jaya")).toBe("PT Maju = Jaya");
      expect(escapeCSVCell("a@b.co")).toBe("a@b.co");
      expect(escapeCSVCell("")).toBe("");
      expect(escapeCSVCell("Ibu Siti Rahayu, Tbk.")).toBe('"Ibu Siti Rahayu, Tbk."');
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
      expect(formatDateForExport(new Date("invalid"))).toBe("");
    });

    it("uses the Asia/Jakarta calendar date (UTC+7), not the UTC date", () => {
      // 23:59:59 WIB stays on the same day; 00:00 WIB is the next day.
      expect(formatDateForExport(new Date("2026-10-09T16:59:59.999Z"))).toBe("2026-10-09");
      expect(formatDateForExport(new Date("2026-10-09T17:00:00.000Z"))).toBe("2026-10-10");
      expect(formatDateForExport("2026-10-09T17:30:00.000Z")).toBe("2026-10-10");
      // Month and year boundaries.
      expect(formatDateForExport(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
      expect(formatDateForExport(new Date("2026-02-28T18:00:00.000Z"))).toBe("2026-03-01");
      // UTC midnight (how date-only inputs are stored) keeps its date.
      expect(formatDateForExport(new Date("2026-08-01"))).toBe("2026-08-01");
    });

    it("converts ISO strings with an offset and keeps zone-less calendar values", () => {
      expect(formatDateForExport("2026-10-09T23:30:00+07:00")).toBe("2026-10-09");
      expect(formatDateForExport("2026-10-09T20:00:00-05:00")).toBe("2026-10-10");
      expect(formatDateForExport("2026-10-09T23:30:00")).toBe("2026-10-09");
      expect(formatDateForExport("2026-10-09")).toBe("2026-10-09");
    });

    it("accepts another IANA timezone explicitly", () => {
      expect(formatDateForExport(new Date("2026-10-09T17:30:00.000Z"), "UTC")).toBe("2026-10-09");
      expect(formatDateForExport(new Date("2026-10-09T16:30:00.000Z"), "Asia/Jayapura")).toBe("2026-10-10");
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

    it("neutralises formula-like text cells but keeps a negative Total numeric", () => {
      const csv = exportToCSV([
        {
          number: "INV-202608-003",
          client: '=HYPERLINK("http://evil.example","x")',
          status: "PAID",
          issuedAt: "2026-08-03",
          dueAt: null,
          total: -250000,
          currency: "IDR",
        },
      ]);
      expect(csv.split("\r\n")[1]).toBe(
        'INV-202608-003,"\'=HYPERLINK(""http://evil.example"",""x"")",PAID,2026-08-03,,-250000,IDR',
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
      expect(xml).toContain('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
      expect(xml).toContain('xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');
      expect(xml).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
      expect(xml).toContain('xmlns:x="urn:schemas-microsoft-com:office:excel"');
      expect(xml).not.toContain("microsoft-microsoft");
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

    it("is well-formed XML and keeps formula-like text as String data", () => {
      const xml = exportToXLSX([
        { ...sampleData[0], client: '=HYPERLINK("http://evil.example","x")', issuedAt: new Date("2026-10-09T17:30:00.000Z") },
      ]);
      expect(xml).toContain('<Data ss:Type="String">=HYPERLINK(&quot;http://evil.example&quot;,&quot;x&quot;)</Data>');
      expect(xml).not.toContain("ss:Formula");
      expect(xml).toContain('<Data ss:Type="String">2026-10-10</Data>');
      expect(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror")).toHaveLength(0);
    });

    it("alias generateXLSX produces identical output", () => {
      expect(generateXLSX(sampleData)).toBe(exportToXLSX(sampleData));
    });
  });
});
