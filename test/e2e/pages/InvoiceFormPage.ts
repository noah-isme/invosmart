import { expect, type Locator, type Page } from "@playwright/test";

export type InvoiceFormItem = { name: string; qty: number | string; price: number | string };

/**
 * /app/invoices/new (components/invoices/InvoiceFormClient.tsx).
 *
 * Every field is an <input> nested in its <label>, so getByLabel works; item
 * fields repeat per row and are addressed by index. There is no client picker:
 * the client is a free-text name ("Nama Klien"), and the currency select is
 * not part of the submitted payload. Validation errors set aria-invalid on the
 * field and render a sibling span with id `client-error`, `item-<i>-name-error`, ...
 */
export class InvoiceFormPage {
  readonly heading: Locator;
  readonly client: Locator;
  readonly currency: Locator;
  readonly dueAt: Locator;
  readonly notes: Locator;
  readonly addItemButton: Locator;
  readonly saveDraftButton: Locator;
  readonly sendButton: Locator;
  /** Live totals (dl): Subtotal, Pajak (10%), Total. */
  readonly totals: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Buat Invoice Manual" });
    this.client = page.getByLabel("Nama Klien");
    this.currency = page.getByLabel("Mata Uang");
    this.dueAt = page.getByLabel("Jatuh Tempo");
    this.notes = page.getByLabel("Catatan (opsional)");
    this.addItemButton = page.getByRole("button", { name: "Tambah item" });
    this.saveDraftButton = page.getByRole("button", { name: "Simpan sebagai Draft" });
    this.sendButton = page.getByRole("button", { name: "Kirim Invoice" });
    this.totals = page.locator("dl").filter({ hasText: "Subtotal" });
  }

  async goto(): Promise<void> {
    await this.page.goto("/app/invoices/new");
    await expect(this.heading).toBeVisible();
  }

  itemName(index = 0): Locator {
    return this.page.getByLabel("Nama item").nth(index);
  }

  itemQty(index = 0): Locator {
    return this.page.getByLabel("Jumlah").nth(index);
  }

  itemPrice(index = 0): Locator {
    return this.page.getByLabel(/^Harga/).nth(index);
  }

  /** Field-level error element by the id the form renders (e.g. "client-error", "item-0-name-error"). */
  fieldError(id: string): Locator {
    return this.page.locator(`[id="${id}"]`);
  }

  /** The form-level error paragraph (server error message). */
  formError(text: string | RegExp): Locator {
    return this.page.locator("section p").filter({ hasText: text });
  }

  /** Fill the form; `dueAt` is a `datetime-local` value (YYYY-MM-DDTHH:mm, browser-local time). */
  async fill(input: { client: string; dueAt?: string; notes?: string; items: InvoiceFormItem[] }): Promise<void> {
    await this.client.fill(input.client);
    if (input.dueAt !== undefined) await this.dueAt.fill(input.dueAt);
    if (input.notes !== undefined) await this.notes.fill(input.notes);
    for (const [index, item] of input.items.entries()) {
      if (index > 0) await this.addItemButton.click();
      await this.itemName(index).fill(item.name);
      await this.itemQty(index).fill(String(item.qty));
      await this.itemPrice(index).fill(String(item.price));
    }
  }

  async saveDraft(): Promise<void> {
    await this.saveDraftButton.click();
  }
}
