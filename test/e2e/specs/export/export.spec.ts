// F7 Export: EXP-01..06 (plan .plans/e2e-scenarios.md, "F7 Export").
//
// Read-only, black-box HTTP checks: lib/export-utils.ts and
// app/api/invoices/export/ are never modified here (momus-gated).
//
// Verified against the code:
// - GET /api/invoices/export?format=csv|xlsx[&status=<InvoiceStatus>|ALL]
//   (default csv). Any other format -> 400, an unknown status -> 400, no
//   session -> 401, no readable workspace -> 403. Rows are the active
//   workspace's invoices (workspaceScope), newest first, no row limit.
// - CSV: header "Invoice Number,Client Name,Status,Issued Date,Due Date,Total,Currency",
//   CRLF line breaks, RFC 4180 quoting only for '"', ',', CR, LF
//   (escapeCSVCell); no formula neutralising (EXP-05). Dates are
//   toISOString().split("T")[0], i.e. the UTC date (EXP-06).
// - "xlsx": exportToXLSX returns SpreadsheetML 2003 XML text, served with the
//   OOXML content type and an .xlsx file name (EXP-02 product bug).
import { expect, test, type Api } from "../../fixtures";
import type { InvoiceRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));
const EXPORT = "/api/invoices/export";
const HEADER = ["Invoice Number", "Client Name", "Status", "Issued Date", "Due Date", "Total", "Currency"];

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF/LF records). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type CsvRecord = Record<(typeof HEADER)[number], string>;

async function exportCsv(api: Api, query = "") {
  const response = await api.get(`${EXPORT}?format=csv${query}`);
  expect(response.status()).toBe(200);
  const text = await response.text();
  const [header, ...rows] = parseCsv(text);
  expect(header).toEqual(HEADER);
  const records = rows.map((cells) => Object.fromEntries(HEADER.map((name, index) => [name, cells[index]])) as CsvRecord);
  return { response, text, records };
}

const byNumber = (records: CsvRecord[], invoice: Pick<InvoiceRecord, "number">) =>
  records.find((record) => record["Invoice Number"] === invoice.number);

test.describe("export", () => {
  test(
    "EXP-01 CSV export of 3 mixed-status invoices: text/csv, header + 3 rows, totals match",
    { annotation: covers(EXPORT) },
    async ({ newApiUser }) => {
      const { api, factory } = await newApiUser("exp01");
      const draft = await factory.createInvoice({ client: `EXP-01 draft ${tag()}`, items: [{ name: "A", qty: 1, price: 100_000 }] });
      const sent = await factory.createInvoice({ client: `EXP-01 sent ${tag()}`, status: "SENT", items: [{ name: "B", qty: 2, price: 75_000 }] });
      const paid = await factory.createInvoice({ client: `EXP-01 paid ${tag()}`, status: "PAID", items: [{ name: "C", qty: 3, price: 40_000 }] });

      const { response, records } = await exportCsv(api);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="invoices-export-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(records).toHaveLength(3);

      for (const invoice of [draft, sent, paid]) {
        expect(byNumber(records, invoice)).toEqual({
          "Invoice Number": invoice.number,
          "Client Name": invoice.client,
          Status: invoice.status,
          "Issued Date": invoice.issuedAt.slice(0, 10),
          "Due Date": invoice.dueAt?.slice(0, 10) ?? "",
          Total: String(invoice.total),
          Currency: "IDR",
        });
      }
      expect(records.map((record) => record.Status).sort()).toEqual(["DRAFT", "PAID", "SENT"]);
      const sum = records.reduce((acc, record) => acc + Number(record.Total), 0);
      expect(sum).toBe(draft.total + sent.total + paid.total);
    },
  );

  test(
    "EXP-02 ?format=xlsx returns SpreadsheetML XML (<?xml ... <Workbook) under an .xlsx name",
    {
      annotation: [
        ...covers(EXPORT),
        {
          type: "product-bug",
          description:
            "?format=xlsx serves SpreadsheetML 2003 XML (starts with <?xml, root <Workbook>) with the OOXML content type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet and an .xlsx file name; a real .xlsx is a ZIP (PK\\x03\\x04). Excel warns about the format/extension mismatch. The Workbook namespace is also misspelled (urn:schemas-microsoft-microsoft-com:office:spreadsheet). Fix belongs to lib/export-utils.ts (momus-gated).",
        },
      ],
    },
    async ({ newApiUser }) => {
      const { api, factory } = await newApiUser("exp02");
      const invoice = await factory.createInvoice({ client: `EXP-02 <&> ${tag()}` });

      const response = await api.get(`${EXPORT}?format=xlsx`);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expect(headers["content-disposition"]).toMatch(/filename="invoices-export-\d{4}-\d{2}-\d{2}\.xlsx"$/);
      test.info().annotations.push({ type: "observed-content-type", description: headers["content-type"] });

      const body = await response.body();
      // Actual bytes: XML text, not a ZIP container.
      expect(body.subarray(0, 2).toString("latin1")).not.toBe("PK");
      const text = body.toString("utf8");
      expect(text.startsWith("<?xml")).toBe(true);
      expect(text).toContain("<Workbook");
      expect(text).toContain('<Worksheet ss:Name="Invoices">');
      expect(text).toContain(`<Data ss:Type="String">${invoice.number}</Data>`);
      // The client name is XML-escaped.
      expect(text).toContain(invoice.client.replace("<&>", "&lt;&amp;&gt;"));
      expect(text).toContain(`<Data ss:Type="Number">${invoice.total}</Data>`);
    },
  );

  test(
    "EXP-03 ?status=PAID exports only PAID rows; ?format=pdf and an unknown status are 400",
    { annotation: covers(EXPORT) },
    async ({ newApiUser }) => {
      const { api, factory } = await newApiUser("exp03");
      const paid = await factory.createInvoice({ status: "PAID" });
      await factory.createInvoice({ status: "SENT" });
      await factory.createInvoice();

      const { records } = await exportCsv(api, "&status=PAID");
      expect(records.map((record) => record["Invoice Number"])).toEqual([paid.number]);
      expect(records[0].Status).toBe("PAID");

      const lower = await exportCsv(api, "&status=paid");
      expect(lower.records.map((record) => record["Invoice Number"])).toEqual([paid.number]);
      const all = await exportCsv(api, "&status=ALL");
      expect(all.records).toHaveLength(3);

      expect((await api.get(`${EXPORT}?format=pdf`)).status()).toBe(400);
      expect((await api.get(`${EXPORT}?format=csv&status=BOGUS`)).status()).toBe(400);
    },
  );

  test(
    "EXP-04 user B's export does not contain user A's invoices",
    { annotation: covers(EXPORT) },
    async ({ newApiUser }) => {
      const a = await newApiUser("exp04-a");
      const b = await newApiUser("exp04-b");
      const aInvoice = await a.factory.createInvoice({ client: `EXP-04 A ${tag()}` });
      const bInvoice = await b.factory.createInvoice({ client: `EXP-04 B ${tag()}` });

      const { text, records } = await exportCsv(b.api);
      expect(records.map((record) => record["Invoice Number"])).toEqual([bInvoice.number]);
      expect(text).not.toContain(aInvoice.client);

      // A's invoice number may coincide with B's (numbers are per workspace),
      // so A's side is checked by client name.
      const xlsx = await (await b.api.get(`${EXPORT}?format=xlsx`)).text();
      expect(xlsx).not.toContain(aInvoice.client);

      // An organizationId hint for A's workspace is not an authorisation claim.
      const hinted = await b.api.get(`${EXPORT}?format=csv&organizationId=${encodeURIComponent(a.user.workspace.organizationId)}`);
      expect(hinted.status()).toBe(403);
    },
  );

  test(
    "EXP-05 a formula-like client name is neutralised in the CSV (CSV injection)",
    {
      annotation: [
        ...covers(EXPORT),
        {
          type: "product-bug",
          description:
            "CSV formula injection: escapeCSVCell only applies RFC 4180 quoting, so a client named =HYPERLINK(\"http://evil.example\",\"x\") is exported as \"=HYPERLINK(\"\"http://evil.example\"\",\"\"x\"\")\", which spreadsheet apps evaluate as a formula. Desired: cells starting with = + - @ TAB CR are prefixed (e.g. with ') so they are text.",
        },
      ],
    },
    async ({ newApiUser }) => {
      test.fail(true, "product bug: CSV export does not neutralise formula cells (lib/export-utils.ts escapeCSVCell, momus-gated)");
      const { api, factory } = await newApiUser("exp05");
      const formula = '=HYPERLINK("http://evil.example","x")';
      const client = await factory.createClient({ name: formula });
      const invoice = await factory.createInvoice({ client: formula, clientId: client.id });
      expect(invoice.client).toBe(formula);

      const { text, records } = await exportCsv(api);
      const record = byNumber(records, invoice);
      expect(record, "the invoice row is exported").toBeDefined();
      const rawLine = text.split("\r\n").find((line) => line.startsWith(`${invoice.number},`)) ?? "";
      test.info().annotations.push(
        { type: "observed-raw-csv-line", description: rawLine },
        { type: "observed-client-cell", description: record!["Client Name"] },
      );

      // Desired: the parsed cell is not a formula (no leading = + - @ TAB CR)
      // and still carries the original text.
      expect(record!["Client Name"], "client cell must not start a formula").not.toMatch(/^[=+\-@\t\r]/);
      expect(record!["Client Name"]).toContain("HYPERLINK");
    },
  );

  test(
    "EXP-06 the exported due date is the Asia/Jakarta calendar date",
    {
      annotation: [
        ...covers(EXPORT),
        {
          type: "product-bug",
          description:
            "formatDateForExport uses toISOString().split(\"T\")[0] (UTC), so dueAt <today>T17:30:00.000Z, which is 00:30 the next day in Asia/Jakarta (UTC+7), is exported as <today>. Desired: the Jakarta date (<today+1>).",
        },
      ],
    },
    async ({ newApiUser }) => {
      test.fail(true, "product bug: export dates are UTC, not Asia/Jakarta (lib/export-utils.ts formatDateForExport, momus-gated)");
      const { api, factory } = await newApiUser("exp06");
      const utcToday = new Date().toISOString().slice(0, 10);
      const dueAt = `${utcToday}T17:30:00.000Z`;
      const jakartaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(dueAt));
      // A DRAFT with a past dueAt stays DRAFT (only SENT/UNPAID turn OVERDUE).
      const invoice = await factory.createInvoice({ dueAt });
      expect(invoice.dueAt).toBe(dueAt);
      expect(jakartaDate).not.toBe(utcToday);

      const { records } = await exportCsv(api);
      const record = byNumber(records, invoice);
      expect(record, "the invoice row is exported").toBeDefined();
      test.info().annotations.push(
        { type: "observed-due-date", description: `dueAt ${dueAt} exported as ${record!["Due Date"]}; Jakarta date ${jakartaDate}` },
      );

      expect(record!["Due Date"], "due date must be the Asia/Jakarta date").toBe(jakartaDate);
    },
  );
});
