import { expect, type Locator, type Page } from "@playwright/test";

export type ClientFormInput = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  address?: string;
  currency?: string;
  notes?: string;
};

/**
 * /app/clients/new and /app/clients/new?edit=<id>
 * (app/app/clients/new/ClientFormClient.tsx).
 *
 * The <label> elements are not associated with their inputs (no htmlFor, not
 * nested), so fields are addressed by their `name` attribute. On a non-OK
 * response the form shows `error.message || error` from the JSON body in a
 * plain div.
 */
export class ClientFormPage {
  readonly createHeading: Locator;
  readonly editHeading: Locator;
  readonly save: Locator;

  constructor(readonly page: Page) {
    this.createHeading = page.getByRole("heading", { name: "Create New Client" });
    this.editHeading = page.getByRole("heading", { name: "Edit Client" });
    this.save = page.getByRole("button", { name: "Save Client" });
  }

  field(name: keyof ClientFormInput): Locator {
    const tag = name === "address" || name === "notes" ? "textarea" : name === "currency" ? "select" : "input";
    return this.page.locator(`form ${tag}[name="${name}"]`);
  }

  async gotoNew(): Promise<void> {
    await this.page.goto("/app/clients/new");
    await expect(this.createHeading).toBeVisible();
  }

  async gotoEdit(clientId: string): Promise<void> {
    await this.page.goto(`/app/clients/new?edit=${encodeURIComponent(clientId)}`);
    await expect(this.editHeading).toBeVisible();
  }

  async fill(input: ClientFormInput): Promise<void> {
    for (const [key, value] of Object.entries(input) as Array<[keyof ClientFormInput, string | undefined]>) {
      if (value === undefined) continue;
      if (key === "currency") await this.field(key).selectOption(value);
      else await this.field(key).fill(value);
    }
  }

  /** Click "Save Client" and return the POST/PUT /api/clients[/<id>] response. */
  async submit() {
    const response = this.page.waitForResponse(
      (r) => /^\/api\/clients(\/[^/]+)?$/.test(new URL(r.url()).pathname) && ["POST", "PUT"].includes(r.request().method()),
    );
    await this.save.click();
    return response;
  }
}
