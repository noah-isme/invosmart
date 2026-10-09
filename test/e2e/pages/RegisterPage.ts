import { expect, type Locator, type Page } from "@playwright/test";

/** /auth/register (app/auth/register/page.tsx). */
export class RegisterPage {
  readonly heading: Locator;
  readonly name: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  /** FormError (role=alert); Next's route announcer also has role=alert, so it is excluded. */
  readonly formError: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Daftar akun baru" });
    this.name = page.getByLabel("Nama lengkap");
    this.email = page.getByLabel("Email");
    this.password = page.getByLabel("Password");
    this.submit = page.getByRole("button", { name: "Daftar", exact: true });
    this.formError = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  }

  async goto(): Promise<void> {
    await this.page.goto("/auth/register");
    await expect(this.heading).toBeVisible();
  }

  async register(input: { name: string; email: string; password: string }): Promise<void> {
    await this.name.fill(input.name);
    await this.email.fill(input.email);
    await this.password.fill(input.password);
    await this.submit.click();
  }
}
