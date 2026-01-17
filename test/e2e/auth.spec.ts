import { expect, test } from "@playwright/test";

test.describe("Authentication Flow", () => {
  const timestamp = Date.now();
  const user = {
    name: "Test User",
    email: `test-user-${timestamp}@example.com`,
    password: "password123",
  };

  test("should allow a user to register", async ({ page }) => {
    await page.goto("/auth/register");

    await page.getByLabel("Nama lengkap").fill(user.name);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    
    await page.getByRole("button", { name: "Daftar" }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByText("Registrasi berhasil")).toBeVisible();
  });

  test("should allow a user to login", async ({ page }) => {
    await page.goto("/auth/register");
    await page.getByLabel("Nama lengkap").fill(user.name);
    const loginEmail = `login-${timestamp}@example.com`;
    await page.getByLabel("Email").fill(loginEmail);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Daftar" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(loginEmail);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Masuk" }).click();

    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByText("Total Pendapatan")).toBeVisible();
  });

  test("should show error for invalid login", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill("invalid@example.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Masuk" }).click();

    await expect(page.getByText("Email atau password salah")).toBeVisible();
  });
});
