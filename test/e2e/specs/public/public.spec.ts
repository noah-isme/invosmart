// F21 Static pages and health: PUB-01..03 (plan .plans/e2e-scenarios.md,
// "F21 Static pages and health"). PUB-01 replaces the legacy
// test/e2e/qa.e2e.spec.ts banner check (its screenshot and theme-toggle
// simulation parts were dropped: they asserted nothing).
//
// Verified against the code:
// - The root layout (app/layout.tsx) renders components/layout/Banner.tsx, a
//   div with role="banner" and the text "<emoji> InvoSmart <APP_VERSION> is
//   live! ...", plus a "Tutup pengumuman" close button. `/` itself (app/page.tsx)
//   is outside the middleware matcher, so it needs no session.
// - /app/help (h1 "Pusat Bantuan") and /app/about (h1 "InvoSmart <APP_VERSION>",
//   lib/release.ts: NEXT_PUBLIC_APP_VERSION normalised to a leading "v",
//   default "v1.0.0") live under /app, which middleware.ts guards with
//   next-auth, so PUB-02 runs as the default owner persona.
// - GET /api/health answers 200 { status: "ok", timestamp } without a session.
import { expect, test } from "../../fixtures";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const VERSION = /v\d+\.\d+\.\d+\S*/;

test.describe("public pages: signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "PUB-01 the home page banner contains InvoSmart and the release version",
    { tag: "@smoke", annotation: covers("/") },
    async ({ page }) => {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      const banner = page.getByRole("banner").filter({ hasText: "InvoSmart" });
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(new RegExp(`InvoSmart ${VERSION.source} is live!`));
      await expect(banner.getByRole("button", { name: "Tutup pengumuman" })).toBeVisible();
    },
  );

  test(
    "PUB-03 GET /api/health answers 200 with status ok and no session",
    { tag: "@smoke", annotation: covers("/api/health") },
    async ({ request }) => {
      const response = await request.get("/api/health");
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("application/json");
      const body = (await response.json()) as { status: string; timestamp: string };
      expect(body.status).toBe("ok");
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    },
  );
});

test.describe("public pages: signed in", () => {
  test(
    "PUB-02 /app/help shows Pusat Bantuan and /app/about shows InvoSmart v<version>",
    { annotation: covers("/app/help", "/app/about") },
    async ({ page }) => {
      await page.goto("/app/help");
      await expect(page).toHaveURL(/\/app\/help$/);
      await expect(page.getByRole("heading", { level: 1, name: "Pusat Bantuan" })).toBeVisible();

      await page.goto("/app/about");
      await expect(page).toHaveURL(/\/app\/about$/);
      const heading = page.getByRole("heading", { level: 1, name: new RegExp(`^InvoSmart ${VERSION.source}$`) });
      await expect(heading).toBeVisible();
      // Same release string as the layout banner.
      const version = (await heading.textContent())!.replace(/^InvoSmart /, "").trim();
      await expect(page.getByRole("banner").filter({ hasText: "InvoSmart" })).toContainText(`InvoSmart ${version} is live!`);
    },
  );
});
