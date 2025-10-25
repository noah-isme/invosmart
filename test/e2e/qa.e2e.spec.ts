import { expect, test } from "@playwright/test";

const screenshotDir = "QA-report/screenshots";

test.describe("InvoSmart launch smoke", () => {
  test("renders launch banner on home page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByText(/InvoSmart/)).toBeVisible();
    await page.screenshot({ path: `${screenshotDir}/home.png`, fullPage: true });
  });

  test("allows client-side theme toggle simulation", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${screenshotDir}/theme-light.png`, fullPage: true });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${screenshotDir}/theme-dark.png`, fullPage: true });
  });
});
