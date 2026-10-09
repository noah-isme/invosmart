import { expect, type Locator, type Page } from "@playwright/test";

/** /auth/login (app/auth/login/login-form.tsx). */
export class LoginPage {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly googleButton: Locator;
  /** FormError (role=alert); Next's route announcer also has role=alert, so it is excluded. */
  readonly formError: Locator;
  /** FormSuccess (role=status), e.g. the post-registration message. */
  readonly formSuccess: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole("heading", { name: "Masuk ke Invosmart" });
    this.email = page.getByLabel("Email");
    this.password = page.getByLabel("Password");
    this.submit = page.getByRole("button", { name: "Masuk", exact: true });
    this.googleButton = page.getByRole("button", { name: "Lanjutkan dengan Google" });
    this.formError = page.locator('[role="alert"]:not(#__next-route-announcer__)');
    this.formSuccess = page.getByRole("status").filter({ hasText: /\S/ });
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/auth/login${query}`);
    await expect(this.heading).toBeVisible();
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
