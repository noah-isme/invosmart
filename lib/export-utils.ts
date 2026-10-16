export interface InvoiceExportData {
  number: string;
  client: string;
  status: string;
  issuedAt: string | Date;
  dueAt?: string | Date | null;
  total: number;
  currency?: string | null;
}

/**
 * Leading characters that make spreadsheet apps evaluate a cell as a formula,
 * including after leading whitespace (spaces, NBSP and other Unicode spaces),
 * which Excel and LibreOffice skip when parsing a cell.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]|^[\s\u00a0]+[=+\-@]/;

/**
 * Escapes a cell value for CSV formatting per RFC 4180 rules.
 * If the value contains commas, double quotes, or line breaks,
 * it is wrapped in double quotes and any internal double quotes are doubled.
 *
 * CSV injection (OWASP): a STRING value starting with `=`, `+`, `-`, `@`, tab
 * or carriage return (optionally after leading whitespace) is prefixed with a
 * single quote so spreadsheet apps show it as text instead of evaluating it. Only strings are prefixed: numbers
 * (the Total column is passed as a number) are written unchanged, so a
 * negative amount stays a number. A text field that happens to start with
 * `-` or `+` (e.g. "+62 811...") is prefixed too; that is intended.
 */
export function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str = String(value);
  if (typeof value === "string" && FORMULA_TRIGGER.test(str)) {
    str = `'${str}`;
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Business timezone for exported calendar dates. Neither Invoice nor
 * Organization stores a timezone, so every export uses the Indonesian
 * business date (WIB, UTC+7, no DST).
 */
export const EXPORT_TIME_ZONE = "Asia/Jakarta";

/** An ISO 8601 date-time that pins an instant (ends in Z or a ±hh:mm offset). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/i;

const calendarDateIn = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

/**
 * Formats a date into YYYY-MM-DD format for export output, as the calendar
 * date in `timeZone` (default Asia/Jakarta), not the UTC date.
 *
 * - Date objects and ISO strings with Z or an offset are instants and are
 *   converted to the business date (2026-10-09T17:30:00Z -> 2026-10-10).
 * - Date-only strings ("2026-10-09") and date-times without a zone are
 *   already calendar values: their date part is kept unchanged.
 */
export function formatDateForExport(
  val: string | Date | null | undefined,
  timeZone: string = EXPORT_TIME_ZONE,
): string {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return calendarDateIn(val, timeZone);
  }
  const str = String(val).trim();
  if (!str) return "";
  if (ISO_INSTANT.test(str)) {
    const instant = new Date(str);
    if (!isNaN(instant.getTime())) return calendarDateIn(instant, timeZone);
  }
  if (str.includes("T")) {
    return str.split("T")[0];
  }
  return str;
}

/**
 * Escapes special XML characters for SpreadsheetML format.
 */
export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Exports an array of invoice export data into RFC 4180 compliant CSV string.
 * Required columns: Invoice Number, Client Name, Status, Issued Date, Due Date, Total, Currency.
 */
export function exportToCSV(invoices: InvoiceExportData[]): string {
  const headers = [
    "Invoice Number",
    "Client Name",
    "Status",
    "Issued Date",
    "Due Date",
    "Total",
    "Currency",
  ];

  const rows = invoices.map((inv) => [
    escapeCSVCell(inv.number),
    escapeCSVCell(inv.client),
    escapeCSVCell(inv.status),
    escapeCSVCell(formatDateForExport(inv.issuedAt)),
    escapeCSVCell(formatDateForExport(inv.dueAt)),
    escapeCSVCell(inv.total),
    escapeCSVCell(inv.currency || "IDR"),
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
}

export const generateCSV = exportToCSV;

/**
 * Exports an array of invoice export data as an Excel 2003 XML Spreadsheet
 * (SpreadsheetML). This is NOT an OOXML .xlsx (a ZIP package): serve it as
 * `.xml` with `application/vnd.ms-excel`, which Excel and LibreOffice open as
 * a workbook. The name is kept for the `?format=xlsx` API value.
 * Text goes into <Data ss:Type="String"> cells, which are never evaluated as
 * formulas, so no CSV-style formula prefix is needed here.
 * Required columns: Invoice Number, Client Name, Status, Issued Date, Due Date, Total, Currency.
 */
export function exportToXLSX(invoices: InvoiceExportData[]): string {
  const headers = [
    "Invoice Number",
    "Client Name",
    "Status",
    "Issued Date",
    "Due Date",
    "Total",
    "Currency",
  ];

  const headerCells = headers
    .map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`)
    .join("\n    ");

  const dataRows = invoices
    .map((inv) => {
      const issued = formatDateForExport(inv.issuedAt);
      const due = formatDateForExport(inv.dueAt);
      const currency = inv.currency || "IDR";
      const totalNum = Number(inv.total) || 0;

      return `   <Row>
    <Cell><Data ss:Type="String">${escapeXml(inv.number)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(inv.client)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(inv.status)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(issued)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(due)}</Data></Cell>
    <Cell><Data ss:Type="Number">${totalNum}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(currency)}</Data></Cell>
   </Row>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>InvoSmart</Author>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
   <Borders/>
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000"/>
   <Interior/>
   <NumberFormat/>
   <Protection/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:FontName="Calibri" x:Family="Swiss" ss:Size="11" ss:Color="#000000" ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Invoices">
  <Table>
   <Row>
    ${headerCells}
   </Row>
${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

export const generateXLSX = exportToXLSX;
