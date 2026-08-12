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
 * Escapes a cell value for CSV formatting per RFC 4180 rules.
 * If the value contains commas, double quotes, or line breaks,
 * it is wrapped in double quotes and any internal double quotes are doubled.
 */
export function escapeCSVCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a date into YYYY-MM-DD format for export output.
 */
export function formatDateForExport(val: string | Date | null | undefined): string {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return val.toISOString().split("T")[0];
  }
  const str = String(val).trim();
  if (!str) return "";
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
 * Exports an array of invoice export data into SpreadsheetML XML format (.xlsx compatible).
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
<Workbook xmlns="urn:schemas-microsoft-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-microsoft-com:office:office">
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
