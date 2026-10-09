// F6 Templates: TPL-01..04 (plan .plans/e2e-scenarios.md, "F6 Templates").
//
// Verified against the code:
// - /app/invoices/templates (page.tsx) server-renders the active workspace's
//   templates into TemplatesClient.tsx: h1 "Template Invoice", a "Template Baru"
//   button that opens the "Buat Template Invoice Baru" modal (labels are not
//   associated with their inputs, so the fields are located by placeholder),
//   one card per template (h3 = name, client, "<n> item invoice", total),
//   "Buat Invoice" (instantiate), "Ubah Nama" (inline rename, PUT) and
//   "Hapus Template" (window.confirm, DELETE). Errors show `body.error`.
// - GET /api/invoices/templates needs read access; POST, PUT/DELETE
//   /api/invoices/templates/<id> and POST .../<id>/instantiate need write
//   access (canWriteWorkspace) and answer 403 "Workspace access denied"
//   before any lookup, so a VIEWER gets 403 in both WORKSPACE_AUTH_MODE values.
// - Instantiate creates a DRAFT invoice with the template's items and totals
//   (dueAt null unless given) and the UI router.push()es to
//   /app/invoices/<id>: one detail render, paced via invoice-detail-budget.
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { reserveInvoiceDetailLoads } from "../../support/invoice-detail-budget";
import type { InvoiceItemInput, InvoiceRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type TemplateRow = { id: string; name: string; client: string; items: InvoiceItemInput[]; total: number; subtotal: number; tax: number };

const templateCard = (page: Page, name: string) =>
  page
    .locator("div")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Buat Invoice" }) })
    .last();

async function createThroughModal(
  page: Page,
  input: { name: string; client: string; item: InvoiceItemInput; notes?: string },
) {
  await page.getByRole("button", { name: "Template Baru" }).click();
  await expect(page.getByRole("heading", { name: "Buat Template Invoice Baru" })).toBeVisible();
  await page.getByPlaceholder("misal: Retainer Bulanan PT ABCD").fill(input.name);
  await page.getByPlaceholder("Nama Klien").fill(input.client);
  await page.getByPlaceholder("Nama Item").fill(input.item.name);
  await page.getByPlaceholder("Qty").fill(String(input.item.qty));
  await page.getByPlaceholder("Harga").fill(String(input.item.price));
  if (input.notes) await page.getByPlaceholder("Catatan default untuk invoice...").fill(input.notes);
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/invoices/templates" && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Simpan Template" }).click();
  return response;
}

test.describe("templates", () => {
  test(
    "TPL-01 a member creates a template; it is listed and GET /api/invoices/templates returns it",
    { annotation: covers("/app/invoices/templates", "/api/invoices/templates") },
    async ({ persona }) => {
      const { page, api } = await persona("member");
      const input = { name: `E2E TPL-01 ${tag()}`, client: `Klien TPL-01 ${tag()}`, item: { name: "Retainer bulanan", qty: 3, price: 250_000 }, notes: "Bayar via transfer" };

      await page.goto("/app/invoices/templates");
      await expect(page.getByRole("heading", { level: 1, name: "Template Invoice" })).toBeVisible();
      const response = await createThroughModal(page, input);
      expect(response.status()).toBe(201);
      const { data: created } = (await response.json()) as { data: TemplateRow };

      await expect(page.getByText("Template baru berhasil dibuat.")).toBeVisible();
      const card = templateCard(page, input.name);
      await expect(card).toBeVisible();
      await expect(card).toContainText(input.client);
      await expect(card).toContainText("1 item invoice");

      // Server-rendered list after a reload.
      await page.reload();
      await expect(templateCard(page, input.name)).toBeVisible();

      const list = await api.get("/api/invoices/templates");
      expect(list.status()).toBe(200);
      const { data } = (await list.json()) as { data: TemplateRow[] };
      const listed = data.find((template) => template.id === created.id);
      expect(listed).toMatchObject({ name: input.name, client: input.client, items: [input.item], subtotal: 750_000, tax: 75_000, total: 825_000 });
    },
  );

  test(
    "TPL-02 'Buat Invoice' instantiates a DRAFT invoice with the template items and opens it",
    { annotation: covers("/app/invoices/templates", "/api/invoices/templates/[id]/instantiate", "/app/invoices/[id]", "/api/invoices/[id]") },
    async ({ isolatedUser }) => {
      // router.push to the detail page: one server-side detail render.
      await reserveInvoiceDetailLoads(1);
      const { page, api, factory } = isolatedUser;
      const items = [
        { name: `Desain logo ${tag()}`, qty: 1, price: 1_500_000 },
        { name: `Revisi ${tag()}`, qty: 2, price: 200_000 },
      ];
      const template = (await factory.createTemplate({ name: `E2E TPL-02 ${tag()}`, client: `Klien TPL-02 ${tag()}`, items })) as unknown as TemplateRow;

      await page.goto("/app/invoices/templates");
      const instantiate = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/templates/${template.id}/instantiate` && r.request().method() === "POST",
      );
      await templateCard(page, template.name).getByRole("button", { name: "Buat Invoice" }).click();
      const response = await instantiate;
      expect(response.status()).toBe(201);
      const { data: invoice } = (await response.json()) as { data: InvoiceRecord };

      await expect(page).toHaveURL(new RegExp(`/app/invoices/${invoice.id}$`));
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
      await expect(page.getByText(`Invoice #${invoice.number}`)).toBeVisible();
      await expect(page.getByText("Draft", { exact: true })).toBeVisible();
      for (const item of items) await expect(page.getByText(item.name, { exact: true })).toBeVisible();

      const detail = await api.get(`/api/invoices/${invoice.id}`);
      expect(detail.status()).toBe(200);
      expect((await detail.json()).data).toMatchObject({
        status: "DRAFT",
        client: template.client,
        items,
        subtotal: template.subtotal,
        tax: template.tax,
        total: template.total,
      });
    },
  );

  test(
    "TPL-03 renaming and deleting a template is reflected in the list and the API",
    { annotation: covers("/app/invoices/templates", "/api/invoices/templates/[id]", "/api/invoices/templates") },
    async ({ isolatedUser }) => {
      const { page, api, factory } = isolatedUser;
      const template = await factory.createTemplate({ name: `E2E TPL-03 ${tag()}` });
      const renamed = `E2E TPL-03 renamed ${tag()}`;

      await page.goto("/app/invoices/templates");
      const card = templateCard(page, template.name);
      await card.hover();
      await card.getByTitle("Ubah Nama").click();
      const input = page.locator("input:focus");
      await expect(input).toHaveValue(template.name);
      await input.fill(renamed);
      const put = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/templates/${template.id}` && r.request().method() === "PUT",
      );
      await page.getByTitle("Simpan").click();
      expect((await put).status()).toBe(200);
      await expect(page.getByText("Nama template berhasil diperbarui.")).toBeVisible();
      await expect(templateCard(page, renamed)).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: template.name, exact: true })).toHaveCount(0);
      expect((await (await api.get(`/api/invoices/templates/${template.id}`)).json()).data.name).toBe(renamed);

      page.once("dialog", (dialog) => void dialog.accept());
      const del = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/api/invoices/templates/${template.id}` && r.request().method() === "DELETE",
      );
      await templateCard(page, renamed).getByTitle("Hapus Template").click();
      expect((await del).status()).toBe(200);
      await expect(page.getByText("Template berhasil dihapus.")).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: renamed, exact: true })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Belum ada template invoice" })).toBeVisible();

      expect((await api.get(`/api/invoices/templates/${template.id}`)).status()).toBe(404);
      const { data } = (await (await api.get("/api/invoices/templates")).json()) as { data: TemplateRow[] };
      expect(data.map((row) => row.id)).not.toContain(template.id);
    },
  );

  test(
    "TPL-04 a VIEWER cannot create or instantiate a template (403) and sees the error",
    { annotation: covers("/app/invoices/templates", "/api/invoices/templates", "/api/invoices/templates/[id]/instantiate") },
    async ({ persona, factory }) => {
      // `factory` acts as the owner persona, in the same RBAC workspace.
      const ownerTemplate = await factory.createTemplate({ name: `E2E TPL-04 owner ${tag()}` });
      const viewer = await persona("viewer");
      const name = `E2E TPL-04 ${tag()}`;

      await viewer.page.goto("/app/invoices/templates");
      await expect(viewer.page.getByRole("heading", { level: 1, name: "Template Invoice" })).toBeVisible();
      const response = await createThroughModal(viewer.page, { name, client: "Klien viewer", item: { name: "Viewer item", qty: 1, price: 1_000 } });
      expect(response.status()).toBe(403);
      await expect(viewer.page.getByText("Workspace access denied")).toBeVisible();

      const direct = await viewer.api.post("/api/invoices/templates", { data: { name, client: "Klien viewer", items: [{ name: "x", qty: 1, price: 1 }] } });
      expect(direct.status()).toBe(403);
      const instantiate = await viewer.api.post(`/api/invoices/templates/${ownerTemplate.id}/instantiate`, { data: {} });
      expect(instantiate.status()).toBe(403);

      const { data } = (await (await viewer.api.get("/api/invoices/templates")).json()) as { data: TemplateRow[] };
      expect(data.map((row) => row.name)).not.toContain(name);
      expect(data.map((row) => row.id)).toContain(ownerTemplate.id);
    },
  );
});
