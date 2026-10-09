// F13 Settings and profile: SET-01..SET-06 (plan .plans/e2e-scenarios.md, "F13 Settings and profile").
//
// Verified against the code:
// - Locale (lib/i18n/context.tsx): I18nProvider (components/ClientProviders.tsx,
//   no initialLocale) starts at "en", applies localStorage `invosmart.locale`,
//   then GET /api/user/locale ({ data: { locale } }) and writes it back to
//   localStorage. setLocale() writes localStorage and PATCHes /api/user/locale.
//   /app/settings/language: h1 is hard-coded ("Pengaturan Bahasa (<name>)");
//   the panel h2 is t("settings.language.subtitle") ("Interface Language" /
//   "Bahasa Tampilan") and the save button t("settings.language.saveButton")
//   ("Save Preference" / "Simpan Pengaturan").
// - Theme (context/ThemeContext.tsx): "Simpan Tema" -> saveTheme() -> PUT
//   /api/user/theme { themePrimary, themeAccent, themeMode }; the provider
//   applies `--color-primary: "<r> <g> <b>"` on <html> and persists to
//   localStorage `invosmart.theme`, then GET /api/user/theme overrides it.
//   ThemeSettingsPanel.tsx:141 is syncBrandingWithTheme(): it sends
//   PATCH /api/user/branding { primaryColor } after the theme PUT, and only
//   when the user's brandingSyncWithTheme is true. So the theme itself is
//   persisted by /api/user/theme; the branding call is a conditional side sync
//   (PATCH, not POST). SET-02 enables the sync and asserts both.
// - Branding (app/api/user/branding/route.ts) exports PUT and PATCH only (no
//   GET -> 405) and answers { data: { logoUrl, primaryColor, fontFamily,
//   brandingSyncWithTheme, useThemeForPdf } }. /app/settings/branding renders
//   the stored values server-side into BrandingForm.
// - /app/profile renders session name (h1 and "Nama" dd) and email ("Email"
//   dd); it has no form or inputs and there is no profile update API, so it is
//   not editable (SET-04 asserts that).
// - /app/settings/performance: h1 "AI predictive optimization", panel h2
//   "Predictive Prefetch" with a role=switch.
// - /app/settings/api: link "Unduh OpenAPI JSON" -> /api/openapi.json (public,
//   OpenAPI 3.0.3 "InvoSmart API"); the page does not print the workspace name:
//   ApiKeyManager is bound to resolveWorkspaceContext(userId) (the active
//   workspace) and lists GET /api/workspaces/<activeId>/api-keys.
//
// Every mutating scenario runs as isolatedUser, so no persona is altered.
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { E2E_APP_URL } from "../../playwright.env";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const LOCALE_STORAGE_KEY = "invosmart.locale";
const THEME_STORAGE_KEY = "invosmart.theme";

const isApi = (method: string, path: string) => (response: { url(): string; request(): { method(): string } }) =>
  response.request().method() === method && new URL(response.url()).pathname === path;

const htmlPrimaryVar = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue("--color-primary").trim());

test.describe("settings and profile", () => {
  test(
    "SET-01 switching the language to Indonesian persists via /api/user/locale and survives a reload without localStorage",
    { annotation: covers("/app/settings/language", "/api/user/locale") },
    async ({ isolatedUser }) => {
      const { page, api } = isolatedUser;

      const before = await api.get("/api/user/locale");
      expect(before.status()).toBe(200);
      expect(await before.json()).toMatchObject({ data: { locale: "en" } });

      await page.goto("/app/settings/language");
      await expect(page.getByRole("heading", { level: 1, name: /Pengaturan Bahasa/ })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Interface Language" })).toBeVisible();

      await page.getByRole("button").filter({ hasText: "Bahasa Indonesia" }).first().click();
      const [patched] = await Promise.all([
        page.waitForResponse(isApi("PATCH", "/api/user/locale")),
        page.getByRole("button", { name: "Save Preference" }).click(),
      ]);
      expect(patched.status()).toBe(200);
      expect(await patched.json()).toMatchObject({ data: { locale: "id" } });
      await expect(page.getByRole("heading", { level: 2, name: "Bahasa Tampilan" })).toBeVisible();
      expect(await page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY)).toBe("id");

      const after = await api.get("/api/user/locale");
      expect(after.status()).toBe(200);
      expect(await after.json()).toMatchObject({ data: { locale: "id" } });

      // Drop the local copy: the translated labels must come from the account.
      await page.evaluate((key) => window.localStorage.removeItem(key), LOCALE_STORAGE_KEY);
      await page.reload();
      await expect(page.getByRole("heading", { level: 2, name: "Bahasa Tampilan" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Simpan Pengaturan" })).toBeVisible();
      await expect
        .poll(() => page.evaluate((key) => window.localStorage.getItem(key), LOCALE_STORAGE_KEY))
        .toBe("id");
    },
  );

  test(
    "SET-02 saving a primary color persists it via /api/user/theme, syncs branding, and sets --color-primary on <html>",
    { annotation: covers("/app/settings/theme", "/api/user/theme", "/api/user/branding") },
    async ({ isolatedUser }) => {
      const { page, api } = isolatedUser;
      const primary = "#12a4b6";
      const primaryRgb = "18 164 182";

      // Turn on brandingSyncWithTheme so ThemeSettingsPanel.tsx:141 (PATCH /api/user/branding) fires.
      const sync = await api.patch("/api/user/branding", { data: { syncWithTheme: true } });
      expect(sync.status()).toBe(200);
      expect(await sync.json()).toMatchObject({ data: { brandingSyncWithTheme: true } });

      // ThemeProvider applies GET /api/user/theme whenever it resolves, overwriting
      // any unsaved edit made before then. Start from a stored non-default color
      // and wait until <html> shows it, so the fetch has landed before editing.
      const seeded = await api.put("/api/user/theme", { data: { themePrimary: "#aa5500" } });
      expect(seeded.status()).toBe(200);

      await page.goto("/app/settings/theme");
      await expect(page.getByRole("heading", { level: 1, name: /Tema personal/ })).toBeVisible();
      await expect.poll(() => htmlPrimaryVar(page)).toBe("170 85 0");
      await expect(page.getByRole("heading", { level: 2, name: "Theme Settings" })).toBeVisible();

      await page.locator("#theme-primary").fill(primary);
      await expect.poll(() => htmlPrimaryVar(page)).toBe(primaryRgb);

      const [themePut, brandingPatch] = await Promise.all([
        page.waitForResponse(isApi("PUT", "/api/user/theme")),
        page.waitForResponse(isApi("PATCH", "/api/user/branding")),
        page.getByRole("button", { name: "Simpan Tema" }).click(),
      ]);
      expect(themePut.status()).toBe(200);
      expect(await themePut.json()).toMatchObject({ data: { primary } });
      expect(brandingPatch.status()).toBe(200);
      expect(await brandingPatch.json()).toMatchObject({ data: { primaryColor: primary, brandingSyncWithTheme: true } });
      await expect(page.getByText("Tema berhasil disimpan.")).toBeVisible();

      const theme = await api.get("/api/user/theme");
      expect(theme.status()).toBe(200);
      expect(await theme.json()).toMatchObject({ data: { primary } });

      // Branding has no GET handler (PUT/PATCH only).
      expect((await api.get("/api/user/branding")).status()).toBe(405);

      // Without the local copy the provider must take the color from the account.
      await page.evaluate((key) => window.localStorage.removeItem(key), THEME_STORAGE_KEY);
      await page.reload();
      await expect(page.getByText(`Tema aktif: ${primary.toUpperCase()}`)).toBeVisible();
      await expect.poll(() => htmlPrimaryVar(page)).toBe(primaryRgb);
    },
  );

  test(
    "SET-03 saving branding echoes the values in the PUT /api/user/branding response and the form shows them after a reload",
    { annotation: covers("/app/settings/branding", "/api/user/branding") },
    async ({ isolatedUser }) => {
      const { page } = isolatedUser;
      // Loopback URL: the guards block non-loopback hosts if anything ever renders it.
      const logoUrl = `${E2E_APP_URL}/e2e-logo-${Date.now()}.png`;
      const primaryColor = "#1e3a8a";

      await page.goto("/app/settings/branding");
      await expect(page.getByRole("heading", { level: 1, name: "Branding dokumen PDF" })).toBeVisible();

      // Role locators only: an earlier locator("form").getByPlaceholder() chain
      // intermittently resolved the hex field twice (not reproducible in the DOM).
      const logoInput = page.getByRole("textbox", { name: "Logo URL" });
      const colorText = page.getByRole("textbox", { name: "#6366F1" });
      const fontSelect = page.getByRole("combobox", { name: "Font utama PDF" });
      const pdfSwitch = page.getByRole("switch", { name: "Gunakan warna tema pada PDF Invoice" });
      const syncSwitch = page.getByRole("switch", { name: "Gunakan warna tema sebagai warna branding" });

      await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
      await expect(pdfSwitch).toHaveAttribute("aria-checked", "false");
      await logoInput.fill(logoUrl);
      await colorText.fill(primaryColor);
      await fontSelect.selectOption("serif");
      await pdfSwitch.click();
      await expect(pdfSwitch).toHaveAttribute("aria-checked", "true");

      const [put] = await Promise.all([
        page.waitForResponse(isApi("PUT", "/api/user/branding")),
        page.getByRole("button", { name: "Simpan perubahan" }).click(),
      ]);
      expect(put.status()).toBe(200);
      expect((await put.json()).data).toEqual({
        logoUrl,
        primaryColor,
        fontFamily: "serif",
        brandingSyncWithTheme: false,
        useThemeForPdf: true,
      });
      await expect(page.getByText("Branding berhasil diperbarui.", { exact: false })).toBeVisible();

      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Branding dokumen PDF" })).toBeVisible();
      await expect(logoInput).toHaveValue(logoUrl);
      await expect(colorText).toHaveValue(primaryColor);
      await expect(fontSelect).toHaveValue("serif");
      await expect(pdfSwitch).toHaveAttribute("aria-checked", "true");
      await expect(syncSwitch).toHaveAttribute("aria-checked", "false");
    },
  );

  test(
    "SET-04 the profile page renders the session name and email and is read-only",
    { annotation: covers("/app/profile") },
    async ({ page, api }) => {
      const session = await api.get("/api/auth/session");
      expect(session.status()).toBe(200);
      const { user } = (await session.json()) as { user: { name: string; email: string } };
      expect(user.name).toBeTruthy();
      expect(user.email).toBeTruthy();

      await page.goto("/app/profile");
      await expect(page.getByRole("heading", { level: 1, name: user.name, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Detail akun" })).toBeVisible();
      const details = page.locator("dl");
      await expect(details.locator("div").filter({ hasText: "Nama" }).locator("dd")).toHaveText(user.name);
      await expect(details.locator("div").filter({ hasText: "Email" }).locator("dd")).toHaveText(user.email);
      // The profile page's own <main> (the innermost one; the app shell may wrap it).
      const main = page.locator("main").filter({ has: page.getByRole("heading", { name: "Detail akun" }) }).last();
      await expect(main.getByRole("link", { name: "Kembali ke dashboard" })).toBeVisible();

      // Not editable: no profile form or inputs on the page (and no profile update API).
      await expect(main.locator("form")).toHaveCount(0);
      await expect(main.locator("input, textarea, select")).toHaveCount(0);
    },
  );

  test(
    "SET-05 the performance settings page renders AI predictive optimization without page errors",
    { annotation: covers("/app/settings/performance") },
    async ({ page, guards }) => {
      await page.goto("/app/settings/performance");
      await expect(page.getByRole("heading", { level: 1, name: "AI predictive optimization" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Predictive Prefetch" })).toBeVisible();
      await expect(page.getByRole("switch")).toBeVisible();
      await expect(page.getByRole("button", { name: /Sinkronkan rekomendasi|Sinkronisasi/ })).toBeVisible();
      expect(guards.pageErrors.map((error) => error.message), "pageerror events").toEqual([]);
    },
  );

  test(
    "SET-06 the API settings page links the OpenAPI document and manages keys of the active workspace",
    { annotation: covers("/app/settings/api", "/api/openapi.json") },
    async ({ isolatedUser }) => {
      const { page, api, factory, user } = isolatedUser;
      const personal = user.workspace.organizationId;
      const { key: personalKey } = await factory.createApiKey(personal, { name: `SET-06 personal ${Date.now()}` });
      const second = await factory.createWorkspace({ name: `SET-06 second ${Date.now()}` });
      const { key: secondKey } = await factory.createApiKey(second.organizationId, { name: `SET-06 second ${Date.now()}` });
      const active = (await factory.listWorkspaces()).find((membership) => membership.active);
      expect(active?.organizationId, "createWorkspace makes the new workspace active").toBe(second.organizationId);

      const openApi = await api.get("/api/openapi.json");
      expect(openApi.status()).toBe(200);
      const document = (await openApi.json()) as { openapi: string; info: { title: string }; paths: Record<string, unknown> };
      expect(document.openapi).toMatch(/^3\./);
      expect(document.info.title).toBe("InvoSmart API");
      expect(Object.keys(document.paths)).toContain("/invoices");

      const listKeysOf = (organizationId: string) => isApi("GET", `/api/workspaces/${organizationId}/api-keys`);

      const [secondList] = await Promise.all([
        page.waitForResponse(listKeysOf(second.organizationId)),
        page.goto("/app/settings/api"),
      ]);
      expect(secondList.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Dokumentasi API" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Unduh OpenAPI JSON/ })).toHaveAttribute("href", "/api/openapi.json");
      await expect(page.getByRole("heading", { level: 2, name: "Kelola API key" })).toBeVisible();
      await expect(page.getByText(secondKey.name as string, { exact: true })).toBeVisible();
      await expect(page.getByText(personalKey.name as string, { exact: true })).toHaveCount(0);

      await factory.switchWorkspace(personal);
      const [personalList] = await Promise.all([
        page.waitForResponse(listKeysOf(personal)),
        page.reload(),
      ]);
      expect(personalList.status()).toBe(200);
      await expect(page.getByText(personalKey.name as string, { exact: true })).toBeVisible();
      await expect(page.getByText(secondKey.name as string, { exact: true })).toHaveCount(0);
    },
  );
});
