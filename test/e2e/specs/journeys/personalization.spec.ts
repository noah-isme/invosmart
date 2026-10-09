// JRN-05 (plan .plans/e2e-scenarios.md, "Cross-feature journeys"): one user
// personalises the app (language, theme, PDF branding) and the settings hold
// together across pages and a reload.
//
// Verified against the code (details in specs/settings/settings.spec.ts and
// specs/invoices/invoices.spec.ts):
// - /app/settings/language "Bahasa Indonesia" + "Save Preference" PATCHes
//   /api/user/locale; the panel then reads "Bahasa Tampilan". The sidebar's
//   sign-out button is translated ("Log Out" / "Keluar").
// - /app/settings/theme: ThemeProvider applies GET /api/user/theme when it
//   resolves (overwriting earlier edits), so the spec seeds a stored color and
//   waits for it on <html> before editing; "Simpan Tema" PUTs /api/user/theme.
// - Detail page "Download PDF" fetches /api/invoices/<id>/pdf and saves
//   `invoice-<number>.pdf`.
// - /app/settings/branding (BrandingForm, not translated) PUTs
//   /api/user/branding and echoes { logoUrl, primaryColor, fontFamily,
//   brandingSyncWithTheme, useThemeForPdf }; the server page renders the stored
//   values after a reload.
import type { Download, Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { E2E_APP_URL } from "../../playwright.env";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const isApi = (method: string, path: string) => (response: { url(): string; request(): { method(): string } }) =>
  response.request().method() === method && new URL(response.url()).pathname === path;

const htmlPrimaryVar = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--color-primary").trim());

async function readDownload(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test(
  "JRN-05 language id -> theme color -> PDF download -> branding saved, echoed and shown after a reload",
  {
    annotation: covers(
      "/app/settings/language",
      "/api/user/locale",
      "/app/settings/theme",
      "/api/user/theme",
      "/app/invoices/[id]",
      "/api/invoices/[id]/pdf",
      "/app/settings/branding",
      "/api/user/branding",
    ),
  },
  async ({ isolatedUser }) => {
    test.slow();
    const { page, api, factory } = isolatedUser;
    const sidebar = page.getByRole("complementary");

    // 1. Language: Indonesian.
    await page.goto("/app/settings/language");
    await expect(page.getByRole("heading", { level: 2, name: "Interface Language" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Log Out" })).toBeVisible();
    await page.getByRole("button").filter({ hasText: "Bahasa Indonesia" }).first().click();
    const [locale] = await Promise.all([
      page.waitForResponse(isApi("PATCH", "/api/user/locale")),
      page.getByRole("button", { name: "Save Preference" }).click(),
    ]);
    expect(locale.status()).toBe(200);
    expect(await locale.json()).toMatchObject({ data: { locale: "id" } });
    await expect(page.getByRole("heading", { level: 2, name: "Bahasa Tampilan" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Keluar" })).toBeVisible();

    // 2. Theme color.
    const primary = "#0f766e";
    const primaryRgb = "15 118 110";
    expect((await api.put("/api/user/theme", { data: { themePrimary: "#aa5500" } })).status()).toBe(200);
    await page.goto("/app/settings/theme");
    await expect(page.getByRole("heading", { level: 1, name: /Tema personal/ })).toBeVisible();
    await expect.poll(() => htmlPrimaryVar(page)).toBe("170 85 0");
    await page.locator("#theme-primary").fill(primary);
    const [theme] = await Promise.all([
      page.waitForResponse(isApi("PUT", "/api/user/theme")),
      page.getByRole("button", { name: "Simpan Tema" }).click(),
    ]);
    expect(theme.status()).toBe(200);
    expect(await theme.json()).toMatchObject({ data: { primary } });
    await expect(page.getByText("Tema berhasil disimpan.")).toBeVisible();
    await expect.poll(() => htmlPrimaryVar(page)).toBe(primaryRgb);

    // 3. PDF download from the invoice page (the theme follows the user).
    const invoice = await factory.createInvoice({ status: "SENT" });
    await page.goto(`/app/invoices/${invoice.id}`);
    await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
    await expect.poll(() => htmlPrimaryVar(page)).toBe(primaryRgb);
    const pdfResponse = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/invoices/${invoice.id}/pdf`);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF" }).click();
    const pdf = await pdfResponse;
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain(invoice.number);
    expect((await readDownload(download)).subarray(0, 4).toString("latin1")).toBe("%PDF");

    // 4. Branding: PUT echoes the values, the page shows them after a reload.
    const logoUrl = `${E2E_APP_URL}/e2e-jrn05-logo-${Date.now()}.png`;
    const brandColor = "#7c2d12";
    await page.goto("/app/settings/branding");
    await expect(page.getByRole("heading", { level: 1, name: "Branding dokumen PDF" })).toBeVisible();
    const logoInput = page.getByRole("textbox", { name: "Logo URL" });
    const colorText = page.getByRole("textbox", { name: "#6366F1" });
    const fontSelect = page.getByRole("combobox", { name: "Font utama PDF" });
    const pdfSwitch = page.getByRole("switch", { name: "Gunakan warna tema pada PDF Invoice" });
    const syncSwitch = page.getByRole("switch", { name: "Gunakan warna tema sebagai warna branding" });
    await logoInput.fill(logoUrl);
    await colorText.fill(brandColor);
    await fontSelect.selectOption("serif");
    await pdfSwitch.click();
    await expect(pdfSwitch).toHaveAttribute("aria-checked", "true");
    const [branding] = await Promise.all([
      page.waitForResponse(isApi("PUT", "/api/user/branding")),
      page.getByRole("button", { name: "Simpan perubahan" }).click(),
    ]);
    expect(branding.status()).toBe(200);
    expect((await branding.json()).data).toEqual({
      logoUrl,
      primaryColor: brandColor,
      fontFamily: "serif",
      brandingSyncWithTheme: false,
      useThemeForPdf: true,
    });

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Branding dokumen PDF" })).toBeVisible();
    await expect(logoInput).toHaveValue(logoUrl);
    await expect(colorText).toHaveValue(brandColor);
    await expect(fontSelect).toHaveValue("serif");
    await expect(pdfSwitch).toHaveAttribute("aria-checked", "true");
    await expect(syncSwitch).toHaveAttribute("aria-checked", "false");

    // Language and theme still hold after the reload.
    await expect(sidebar.getByRole("button", { name: "Keluar" })).toBeVisible();
    await expect.poll(() => htmlPrimaryVar(page)).toBe(primaryRgb);
    expect(await (await api.get("/api/user/locale")).json()).toMatchObject({ data: { locale: "id" } });

    // The branded PDF still renders.
    const branded = await api.get(`/api/invoices/${invoice.id}/pdf`);
    expect(branded.status()).toBe(200);
    expect((await branded.body()).subarray(0, 4).toString("latin1")).toBe("%PDF");
  },
);
