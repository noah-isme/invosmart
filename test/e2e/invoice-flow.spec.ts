import { expect, test } from "@playwright/test";

test.describe("Invoice Management Flow", () => {
  const timestamp = Date.now();
  const user = {
    name: "Invoice User",
    email: `invoice-user-${timestamp}@example.com`,
    password: "password123",
  };

  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByLabel("Nama lengkap").fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Daftar" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/app/);
  });

  test("should create and delete an invoice", async ({ page }) => {
    await page.goto("/app/invoices/new");

    await page.getByPlaceholder("PT Kreatif Nusantara").fill("Test Client " + timestamp);
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(dateStr);

    await page.getByPlaceholder("Tuliskan catatan tambahan untuk klien").fill("Test Note");

    await page.getByPlaceholder("Desain UI").fill("Test Service");
    await page.locator('input[type="number"]').first().fill("2");
    await page.locator('input[type="number"]').nth(1).fill("500000");

    await page.getByRole("button", { name: "Kirim Invoice" }).click();

    await expect(page).toHaveURL(/\/app\/invoices\/.+/);
    await expect(page.getByText("Detail Invoice")).toBeVisible();
    await expect(page.getByText("Test Client " + timestamp)).toBeVisible();

    await page.goto("/app/dashboard");
    await expect(page.getByText("Test Client " + timestamp)).toBeVisible();

    await page.getByText("Test Client " + timestamp).click();
    await page.getByRole("button", { name: "Hapus Invoice" }).click();
    
    await page.getByRole("button", { name: "Hapus", exact: true }).click();

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByText("Test Client " + timestamp)).not.toBeVisible();
  });
});
