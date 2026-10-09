// F3 Invoices: INV-01..11 (plan .plans/e2e-scenarios.md, "F3 Invoices").
//
// Verified against the code:
// - /app/invoices/new renders components/invoices/InvoiceFormClient.tsx: free-text
//   client name (no client picker, no clientId), datetime-local due date, items
//   (name/qty/price), fixed taxRate 0.1. Client-side InvoiceFormSchema runs
//   first; invalid input never reaches the API. On success it router.push()es
//   to /app/invoices/<id> and router.refresh()es.
// - Totals: lib/invoice-utils.ts calculateTotals: subtotal = sum(qty * price),
//   tax = Math.round(subtotal * taxRate), total = subtotal + tax; POST
//   /api/invoices recomputes them server-side, PUT /api/invoices/<id> rejects
//   totals that do not match (400).
// - There is no invoice edit UI (no page sends PUT with changed items; the
//   detail page and dashboard PUT only change the status), so INV-02 edits
//   through the API the UI would use and asserts the detail page and audit log.
// - Detail page (InvoiceDetailClient): "Download PDF" fetches
//   /api/invoices/<id>/pdf and saves a blob as `invoice-<number>.pdf`;
//   "Hapus Invoice" opens an alertdialog whose "Hapus" deletes and routes to
//   /app/dashboard.
// - Dashboard (DashboardContent.tsx): one GET /api/invoices (take: 20, newest
//   first), stat cards (revenue = sum of PAID totals, unpaid = UNPAID count,
//   overdue = OVERDUE count), filter radios with per-status counts from
//   filterCounts, per-row status select + "Update" (PUT) and "Delete". There is
//   no pagination control: with more than 20 invoices only the newest 20 are
//   listed (INV-10).
// - Audit entries use entity "Invoice" / "Client" (lib/audit/auditLogger.ts
//   AuditEntity); the audit-logs `entity` filter is an exact, case-sensitive
//   match, so the plan's `?entity=invoice` is written as `?entity=Invoice`.
// - /app/invoices/<id> loads the invoice directly (lib/invoices/get-invoice.ts),
//   so detail renders no longer share one rate-limit bucket (INV-RL-01).
import type { Download, Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { InvoiceFormPage } from "../../pages/InvoiceFormPage";
import { mintInvoiceShareToken, tamperShareToken } from "../../support/share";
import type { InvoiceRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

/** lib/currency.ts formatCurrency for IDR (id-ID, no fraction digits). */
const idr = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);

/** The documented rule (lib/invoice-utils.ts), computed independently. */
const expectedTotals = (items: Array<{ qty: number; price: number }>, taxRate = 0.1) => {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const tax = Math.round(subtotal * taxRate);
  return { subtotal, tax, total: subtotal + tax };
};

/** `datetime-local` value for today + `days` at 10:00 local time (browser and runner share the TZ). */
const localDateTime = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(10, 0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const detailHeading = (page: Page) => page.getByRole("heading", { name: "Detail Invoice" });
const summaryValue = (page: Page, term: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: term }) }).locator("dd");
const footerRow = (page: Page, label: string) => page.locator("tfoot tr").filter({ hasText: label });

async function readDownload(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test.describe("invoices: create and validate", () => {
  test(
    "INV-01 a member creates an invoice through the form; the detail page shows number, total and DRAFT; the list API has it",
    { tag: "@smoke", annotation: covers("/app/invoices/new", "/api/invoices", "/app/invoices/[id]", "/api/invoices/[id]") },
    async ({ persona }) => {
      const { page, api, factory } = await persona("member");
      const client = await factory.createClient();
      const items = [{ name: "E2E consulting", qty: 2, price: 500_000 }];
      const totals = expectedTotals(items);
      const dueAt = localDateTime(7);
      const notes = `INV-01 note ${Date.now()}`;

      const form = new InvoiceFormPage(page);
      await form.goto();
      await form.fill({ client: client.name, dueAt, notes, items });
      await expect(form.totals).toContainText(idr(totals.subtotal));
      await expect(form.totals).toContainText(idr(totals.total));

      const created = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/invoices" && r.request().method() === "POST",
      );
      await form.saveDraft();
      const response = await created;
      expect(response.status()).toBe(201);
      const { data: invoice } = (await response.json()) as { data: InvoiceRecord };

      await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}$`));
      await expect(detailHeading(page)).toBeVisible();
      await expect(page.getByText(`Invoice #${invoice.number}`)).toBeVisible();
      await expect(page.getByText("Draft", { exact: true })).toBeVisible();
      await expect(summaryValue(page, "Total Tagihan")).toHaveText(idr(totals.total));
      await expect(footerRow(page, "Pajak (10%)")).toContainText(idr(totals.tax));
      await expect(footerRow(page, "Subtotal")).toContainText(idr(totals.subtotal));
      await expect(page.getByText(notes)).toBeVisible();

      expect(invoice).toMatchObject({
        client: client.name,
        status: "DRAFT",
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        items,
        notes,
        dueAt: new Date(dueAt).toISOString(),
      });
      const list = await api.get("/api/invoices");
      expect(list.status()).toBe(200);
      const { data } = (await list.json()) as { data: InvoiceRecord[] };
      expect(data.find((row) => row.id === invoice.id)).toMatchObject({ number: invoice.number, status: "DRAFT", total: totals.total });
    },
  );

  test(
    "INV-08 submitting the empty form shows field errors and creates nothing",
    { annotation: covers("/app/invoices/new") },
    async ({ isolatedUser }) => {
      const { page, api } = isolatedUser;
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname === "/api/invoices") posts.push(request.url());
      });

      const form = new InvoiceFormPage(page);
      await form.goto();
      await form.saveDraft();

      await expect(form.client).toHaveAttribute("aria-invalid", "true");
      await expect(form.fieldError("client-error")).toBeVisible();
      await expect(form.itemName(0)).toHaveAttribute("aria-invalid", "true");
      await expect(form.fieldError("item-0-name-error")).toBeVisible();
      await expect(page).toHaveURL(/\/app\/invoices\/new$/);

      expect(posts).toEqual([]);
      const { data } = (await (await api.get("/api/invoices")).json()) as { data: InvoiceRecord[] };
      expect(data).toEqual([]);
    },
  );

  test(
    "INV-09 a VIEWER submitting the invoice form gets 403 and a visible error",
    { annotation: covers("/app/invoices/new", "/api/invoices") },
    async ({ persona }) => {
      const { page } = await persona("viewer");
      const form = new InvoiceFormPage(page);
      await form.goto();
      await form.fill({ client: `INV-09 ${Date.now()}`, items: [{ name: "Viewer item", qty: 1, price: 1000 }] });

      const created = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/invoices" && r.request().method() === "POST",
      );
      await form.saveDraft();
      expect((await created).status()).toBe(403);
      // The route's own error text (app/api/invoices/route.ts forbidden()), shown as the form error.
      await expect(form.formError("Workspace access denied")).toBeVisible();
      await expect(page).toHaveURL(/\/app\/invoices\/new$/);
    },
  );
});

test.describe("invoices: detail, status, delete", () => {
  test(
    "INV-02 editing the quantity recomputes the totals on the detail page and adds an update audit entry",
    { annotation: covers("/api/invoices/[id]", "/app/invoices/[id]", "/api/admin/audit-logs") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const invoice = await factory.createInvoice({ items: [{ name: "E2E consulting", qty: 2, price: 500_000 }] });
      const items = [{ name: "E2E consulting", qty: 3, price: 500_000 }];
      const totals = expectedTotals(items);

      // No edit UI exists; this is the PUT contract the UI uses (full invoice + matching totals).
      const update = await api.put(`/api/invoices/${invoice.id}`, {
        data: {
          id: invoice.id,
          client: invoice.client,
          items,
          taxRate: 0.1,
          ...totals,
          status: invoice.status,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt,
          notes: invoice.notes,
          currency: invoice.currency,
        },
      });
      expect(update.status()).toBe(200);
      expect((await update.json()).data).toMatchObject({ ...totals, items });

      // Totals that do not match the items are rejected.
      const mismatch = await api.put(`/api/invoices/${invoice.id}`, {
        data: { id: invoice.id, client: invoice.client, items, taxRate: 0.1, subtotal: 1, tax: 0, total: 1, status: invoice.status, issuedAt: invoice.issuedAt, dueAt: invoice.dueAt },
      });
      expect(mismatch.status()).toBe(400);

      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(detailHeading(page)).toBeVisible();
      await expect(summaryValue(page, "Total Tagihan")).toHaveText(idr(totals.total));
      await expect(footerRow(page, "Pajak (10%)")).toContainText(idr(totals.tax));
      await expect(page.locator("tbody tr").filter({ hasText: "E2E consulting" })).toContainText("3");

      await expect
        .poll(async () => {
          const response = await api.get("/api/admin/audit-logs?entity=Invoice&action=INVOICE_UPDATE");
          const { logs } = (await response.json()) as { logs: Array<{ entityId: string; userId: string; details: { total?: number } }> };
          return logs.filter((log) => log.entityId === invoice.id).map((log) => ({ userId: log.userId, total: log.details.total }));
        })
        .toContainEqual({ userId: isolatedUser.user.id, total: totals.total });
    },
  );

  test(
    "INV-03 changing status to SENT then PAID on the dashboard updates the counters",
    { annotation: covers("/app/dashboard", "/api/invoices", "/api/invoices/[id]") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const invoice = await factory.createInvoice();

      const radioCount = (name: string) => page.getByRole("radio", { name, exact: true }).locator("span").nth(1);
      const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: invoice.number }) });
      const revenue = page.locator("article").filter({ hasText: "Total pendapatan" });

      await page.goto("/app/dashboard");
      await expect(row).toBeVisible();
      await expect(radioCount("Draft")).toHaveText("1");
      await expect(radioCount("Sent")).toHaveText("0");
      await expect(revenue).toContainText(idr(0));

      const setStatus = async (status: "SENT" | "PAID") => {
        await row.getByLabel(`Status invoice ${invoice.number}`).selectOption(status);
        const put = page.waitForResponse(
          (r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}` && r.request().method() === "PUT",
        );
        await row.getByRole("button", { name: "Update" }).click();
        expect((await put).status()).toBe(200);
      };

      await setStatus("SENT");
      await expect(radioCount("Sent")).toHaveText("1");
      await expect(radioCount("Draft")).toHaveText("0");

      await setStatus("PAID");
      await expect(radioCount("Paid")).toHaveText("1");
      await expect(radioCount("Sent")).toHaveText("0");
      await expect(revenue).toContainText(idr(invoice.total));

      const body = (await (await api.get("/api/invoices")).json()) as { stats: { revenue: number }; filterCounts: Record<string, number> };
      expect(body.stats.revenue).toBe(invoice.total);
      expect(body.filterCounts).toMatchObject({ ALL: 1, PAID: 1, SENT: 0, DRAFT: 0 });
    },
  );

  test(
    "INV-04 deleting from the detail page removes the invoice; GET /api/invoices/<id> is 404",
    { annotation: covers("/app/invoices/[id]", "/api/invoices/[id]", "/app/dashboard") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const invoice = await factory.createInvoice();

      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(detailHeading(page)).toBeVisible();
      await page.getByRole("button", { name: "Hapus Invoice" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      const deleted = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}` && r.request().method() === "DELETE",
      );
      await dialog.getByRole("button", { name: "Hapus", exact: true }).click();
      expect((await deleted).status()).toBe(204);

      await expect(page).toHaveURL(/\/app\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Belum ada invoice yang tersimpan" })).toBeVisible();
      await expect(page.getByRole("link", { name: invoice.number })).toHaveCount(0);
      expect((await api.get(`/api/invoices/${invoice.id}`)).status()).toBe(404);
    },
  );

  test(
    "INV-05 Download PDF returns application/pdf whose body starts with %PDF, named after the invoice number",
    { tag: "@smoke", annotation: covers("/app/invoices/[id]", "/api/invoices/[id]/pdf") },
    async ({ isolatedUser }) => {
      test.slow();
      const { page, factory } = isolatedUser;
      const invoice = await factory.createInvoice({ status: "SENT" });

      await page.goto(`/app/invoices/${invoice.id}`);
      await expect(detailHeading(page)).toBeVisible();

      const pdfResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}/pdf`,
      );
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download PDF" }).click();
      const response = await pdfResponse;
      const download = await downloadEvent;

      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect(download.suggestedFilename()).toContain(invoice.number);
      const bytes = await readDownload(download);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      await expect(page.getByText("PDF berhasil diunduh.")).toBeVisible();
    },
  );

  test(
    "INV-07 with branding saved, the PDF still downloads with non-empty bytes",
    { annotation: covers("/api/user/branding", "/api/invoices/[id]/pdf") },
    async ({ isolatedUser }) => {
      test.slow();
      const { api, factory } = isolatedUser;
      const invoice = await factory.createInvoice({ status: "SENT" });

      const branding = { primaryColor: "#1E3A8A", fontFamily: "serif" };
      const saved = await api.put("/api/user/branding", { data: branding });
      expect(saved.status()).toBe(200);
      // The route lower-cases the colour.
      expect((await saved.json()).data).toMatchObject({ primaryColor: "#1e3a8a", fontFamily: "serif" });

      const pdf = await api.get(`/api/invoices/${invoice.id}/pdf`);
      expect(pdf.status()).toBe(200);
      expect(pdf.headers()["content-type"]).toContain("application/pdf");
      expect(pdf.headers()["content-disposition"]).toContain(invoice.number);
      const bytes = await pdf.body();
      expect(bytes.length).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    },
  );
});

test.describe("invoices: public share link", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "INV-06 /share/<id> with a valid token renders number and total without a session; a tampered token is 404",
    { annotation: covers("/share/[id]") },
    async ({ page, newApiUser }) => {
      const owner = await newApiUser("inv06");
      const invoice = await owner.factory.createInvoice({ status: "SENT" });
      const token = mintInvoiceShareToken(invoice.id);

      const response = await page.goto(`/share/${invoice.id}?token=${encodeURIComponent(token)}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: `Invoice ${invoice.number}` })).toBeVisible();
      await expect(page.locator("dl > div").filter({ hasText: /^Total/ }).locator("dd")).toHaveText(idr(invoice.total));
      // Still no session in this context.
      expect(await (await page.request.get("/api/auth/session")).json()).toEqual({});

      const tampered = await page.goto(`/share/${invoice.id}?token=${encodeURIComponent(tamperShareToken(token))}`);
      expect(tampered?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: `Invoice ${invoice.number}` })).toHaveCount(0);

      // A valid token for another invoice does not open this one, and no token is 404 too.
      const other = await owner.factory.createInvoice();
      const crossed = await page.goto(`/share/${invoice.id}?token=${encodeURIComponent(mintInvoiceShareToken(other.id))}`);
      expect(crossed?.status()).toBe(404);
      expect((await page.goto(`/share/${invoice.id}`))?.status()).toBe(404);
    },
  );
});

test.describe("invoices: dashboard list and home", () => {
  test(
    "INV-10 with 25 invoices the dashboard lists the newest 20 (no pagination) and counts all 25",
    { annotation: covers("/app/dashboard", "/api/invoices") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const created: InvoiceRecord[] = [];
      for (let index = 0; index < 25; index += 1) {
        created.push(await factory.createInvoice({ client: `E2E list client ${String(index).padStart(2, "0")}` }));
      }
      const newestFirst = [...created].reverse();

      await page.goto("/app/dashboard");
      // Each row links the number and the client name; match the numbers only.
      const numberLinks = page.getByRole("link", { name: /^INV-\d{6}-/ });
      await expect(numberLinks).toHaveCount(20);
      await expect(numberLinks).toHaveText(newestFirst.slice(0, 20).map((invoice) => invoice.number));
      for (const oldest of newestFirst.slice(20)) {
        await expect(page.getByRole("link", { name: oldest.number, exact: true })).toHaveCount(0);
      }
      await expect(page.getByRole("radio", { name: "All", exact: true }).locator("span").nth(1)).toHaveText("25");
      await expect(page.getByRole("radio", { name: "Draft", exact: true }).locator("span").nth(1)).toHaveText("25");
      // No pagination or "load more" control exists.
      await expect(page.getByRole("button", { name: /next|berikut|load more|muat lebih|selanjutnya/i })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: /pagination/i })).toHaveCount(0);

      const body = (await (await api.get("/api/invoices")).json()) as { data: InvoiceRecord[]; filterCounts: Record<string, number> };
      expect(body.data.map((invoice) => invoice.id)).toEqual(newestFirst.slice(0, 20).map((invoice) => invoice.id));
      expect(body.filterCounts.ALL).toBe(25);
    },
  );

  test(
    "INV-11 /app greets the signed-in user by display name",
    { annotation: covers("/app") },
    async ({ isolatedUser }) => {
      const { page, user } = isolatedUser;
      await page.goto("/app");
      await expect(page.getByText("Selamat datang kembali")).toBeVisible();
      const heading = page.getByRole("heading", { level: 1, name: user.name, exact: true });
      await expect(heading).toBeVisible();
      // The sidebar (AppSidebar) also shows the email once useSession resolves,
      // so the greeting's email is scoped to the greeting card.
      await expect(page.locator("section").filter({ has: heading }).getByText(user.email, { exact: true })).toBeVisible();
    },
  );
});
