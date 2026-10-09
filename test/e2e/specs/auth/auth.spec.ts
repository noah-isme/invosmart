// F1 Auth: AUTH-01..12 (plan .plans/e2e-scenarios.md, "F1 Auth").
//
// Verified against the code:
// - Registration: POST /api/auth/register (app/api/auth/register/route.ts) is
//   exempt from CSRF (/api/auth/*), rate-limited per x-forwarded-for in the
//   "auth" bucket of lib/rate-limit.ts (10 per 60 s window, then 429 with
//   Retry-After), validates with RegisterSchema (400 + details.fieldErrors),
//   answers 409 for a duplicate email and returns only { ok: true }.
// - The register page validates client-side first, so malformed input never
//   reaches the API from the UI (AUTH-10 checks both layers).
// - middleware.ts guards /app/* with next-auth withAuth, whose own sign-in
//   page default is /api/auth/signin?callbackUrl=<path>; next-auth then
//   redirects to authOptions.pages.signIn (/auth/login) (AUTH-05).
// - /auth/login is outside the middleware matcher and the page never reads
//   the session, so a signed-in user is shown the form (AUTH-12).
import { expect, test } from "../../fixtures";
import { LoginPage } from "../../pages/LoginPage";
import { RegisterPage } from "../../pages/RegisterPage";
import { apiRequest, ensureActiveWorkspace, registerUser, uniqueEmail } from "../../support/api-factories";
import {
  E2E_SESSION_COOKIE,
  getSessionUser,
  loginViaCredentialsApi,
  mintTamperedSession,
  uniqueForwardedFor,
} from "../../support/auth";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const GENERIC_LOGIN_ERROR = "Email atau password salah.";
const PASSWORD = "E2e-Passw0rd!";

/** `/auth/login` with the next-auth callbackUrl ending in `path` (relative or absolute). */
async function expectSignInRedirect(page: import("@playwright/test").Page, path: string) {
  await expect(page).toHaveURL((url) => url.pathname === "/auth/login");
  const callbackUrl = new URL(page.url()).searchParams.get("callbackUrl") ?? "";
  expect(new URL(callbackUrl, page.url()).pathname).toBe(path);
}

test.describe("auth: signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    "AUTH-01 register through the UI, land on sign-in with the success message; the password is never returned",
    { tag: "@smoke", annotation: covers("/auth/register", "/api/auth/register", "/auth/login") },
    async ({ page }) => {
      const user = { name: "E2E Register", email: uniqueEmail("auth01"), password: PASSWORD };
      const register = new RegisterPage(page);
      await register.goto();

      const registerResponse = page.waitForResponse(
        (response) => response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
      );
      await register.register(user);
      const response = await registerResponse;
      expect(response.status()).toBe(201);
      const registerBody = await response.text();

      await expect(page).toHaveURL(/\/auth\/login\?registered=1$/);
      const login = new LoginPage(page);
      await expect(login.heading).toBeVisible();
      await expect(login.formSuccess).toContainText("Registrasi berhasil");

      // Log in with the new credentials (AUTH-02 covers the UI login).
      const sessionUser = await loginViaCredentialsApi(page.request, user);
      expect(sessionUser).toMatchObject({ email: user.email, name: user.name });

      // APIs that return user records: session, workspaces, members.
      const session = await page.request.get("/api/auth/session");
      const workspace = await ensureActiveWorkspace(page.request);
      const workspaces = await apiRequest(page.request, "GET", "/api/workspaces");
      expect(workspaces.status()).toBe(200);
      const members = await apiRequest(page.request, "GET", `/api/workspaces/${workspace.organizationId}/members`);
      expect(members.status()).toBe(200);
      const membersBody = await members.text();
      expect(membersBody).toContain(user.email);

      const bodies = [registerBody, await session.text(), await workspaces.text(), membersBody];
      for (const body of bodies) {
        expect(body).not.toContain(user.password);
        expect(body).not.toMatch(/"password"\s*:/);
        expect(body).not.toMatch(/\$2[aby]\$\d{2}\$/); // bcrypt hash
      }
    },
  );

  test(
    "AUTH-02 sign in through the UI lands in /app and the dashboard renders",
    { tag: "@smoke", annotation: covers("/auth/login", "/app", "/app/dashboard") },
    async ({ page, api }) => {
      const user = await registerUser(api.request);
      const login = new LoginPage(page);
      await login.goto();
      await login.signIn(user.email, user.password);

      await expect(page).toHaveURL(/\/app(\/|$)/);
      await page.goto("/app/dashboard");
      await expect(page).toHaveURL(/\/app\/dashboard$/);
      await expect(page.getByRole("heading", { name: "Dashboard invoice" })).toBeVisible();
    },
  );

  test(
    "AUTH-03 a wrong password shows the generic error and stays on /auth/login",
    { annotation: covers("/auth/login") },
    async ({ page, api }) => {
      const user = await registerUser(api.request);
      const login = new LoginPage(page);
      await login.goto();
      await login.signIn(user.email, "Wrong-Passw0rd!");

      await expect(login.formError).toHaveText(GENERIC_LOGIN_ERROR);
      await expect(page).toHaveURL((url) => url.pathname === "/auth/login");
      expect(await getSessionUser(page.request)).toBeNull();
    },
  );

  test(
    "AUTH-04 a duplicate email shows a 4xx error and the original password still works",
    { annotation: covers("/auth/register", "/api/auth/register") },
    async ({ page, api }) => {
      const original = await registerUser(api.request);
      const register = new RegisterPage(page);
      await register.goto();

      const registerResponse = page.waitForResponse(
        (response) => response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
      );
      await register.register({ name: "E2E Duplicate", email: original.email, password: "Other-Passw0rd!" });
      const status = (await registerResponse).status();
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
      await expect(register.formError).toBeVisible();
      await expect(register.formError).not.toBeEmpty();
      await expect(page).toHaveURL((url) => url.pathname === "/auth/register");

      const session = await loginViaCredentialsApi(page.request, original);
      expect(session.email).toBe(original.email);
      await expect(loginViaCredentialsApi(api.request, { email: original.email, password: "Other-Passw0rd!" })).rejects.toThrow(
        /CredentialsSignin/,
      );
    },
  );

  test(
    "AUTH-05 /app/dashboard without a session redirects to sign-in with callbackUrl=/app/dashboard",
    { tag: "@smoke", annotation: covers("/app/dashboard", "/auth/login") },
    async ({ page, baseURL }) => {
      // First hop: the middleware sends the browser to next-auth's sign-in endpoint.
      const firstHop = await page.request.get("/app/dashboard", { maxRedirects: 0 });
      expect(firstHop.status()).toBe(307);
      const location = new URL(firstHop.headers()["location"] ?? "", baseURL);
      expect(location.pathname).toBe("/api/auth/signin");
      expect(location.searchParams.get("callbackUrl")).toBe("/app/dashboard");

      await page.goto("/app/dashboard");
      await expectSignInRedirect(page, "/app/dashboard");
      await expect(new LoginPage(page).heading).toBeVisible();
    },
  );

  test(
    "AUTH-07 registrations beyond the limit from one x-forwarded-for get 429 with Retry-After; another address still registers",
    { annotation: [{ type: "expects-429" }, ...covers("/api/auth/register")] },
    async ({ api }) => {
      const ip = uniqueForwardedFor();
      const register = () =>
        api.post("/api/auth/register", {
          headers: { "x-forwarded-for": ip },
          data: { name: "E2E Rate Limit", email: uniqueEmail("auth07"), password: PASSWORD },
        });

      // lib/rate-limit.ts: 10 requests per bucket and IP per 60 s window.
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        expect((await register()).status(), `registration ${attempt}`).toBe(201);
      }
      const limited = await register();
      expect(limited.status()).toBe(429);
      const retryAfter = Number(limited.headers()["retry-after"]);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      // A further attempt from the same address is still limited.
      expect((await register()).status()).toBe(429);

      const fresh = await api.post("/api/auth/register", {
        headers: { "x-forwarded-for": uniqueForwardedFor() },
        data: { name: "E2E Rate Limit", email: uniqueEmail("auth07-fresh"), password: PASSWORD },
      });
      expect(fresh.status()).toBe(201);
    },
  );

  test(
    "AUTH-08 Google sign-in opens the provider host",
    { tag: "@staging", annotation: covers("/auth/login", "/api/auth/[...nextauth]") },
    async ({ page, guards }) => {
      test.skip(process.env.E2E_TIER !== "staging", "Google OAuth runs on staging only (E2E_TIER=staging)");
      const login = new LoginPage(page);
      await login.goto();
      const providerRequest = page.waitForRequest((request) => new URL(request.url()).hostname === "accounts.google.com");
      await login.googleButton.click();
      expect(new URL((await providerRequest).url()).hostname).toBe("accounts.google.com");
      // On staging the guards allow accounts.google.com (stagingAllowedHosts);
      // the local loopback guard would record the provider navigation, which
      // is the point of this test, so such a record is dropped either way.
      const kept = guards.violations.filter((message) => !message.includes("accounts.google.com"));
      guards.violations.splice(0, guards.violations.length, ...kept);
    },
  );

  test(
    "AUTH-09 an unregistered email gets the same generic error as a wrong password",
    { annotation: covers("/auth/login") },
    async ({ page, api }) => {
      const user = await registerUser(api.request);
      const login = new LoginPage(page);
      await login.goto();

      await login.signIn(user.email, "Wrong-Passw0rd!");
      await expect(login.formError).toHaveText(GENERIC_LOGIN_ERROR);
      const wrongPassword = await login.formError.textContent();

      await login.goto();
      await login.signIn(uniqueEmail("auth09-unknown"), PASSWORD);
      await expect(login.formError).toHaveText(GENERIC_LOGIN_ERROR);
      expect(await login.formError.textContent()).toBe(wrongPassword);
      await expect(page).toHaveURL((url) => url.pathname === "/auth/login");
    },
  );

  test(
    "AUTH-10 a short password or malformed email is rejected (400 with the field name) and no user is created",
    { annotation: covers("/api/auth/register", "/auth/register") },
    async ({ page, api }) => {
      const shortPassword = { name: "E2E Short", email: uniqueEmail("auth10-short"), password: "12345" };
      const badEmail = { name: "E2E Bad Email", email: "not-an-email", password: PASSWORD };

      for (const [field, input] of [
        ["password", shortPassword],
        ["email", badEmail],
      ] as const) {
        const response = await api.post("/api/auth/register", { data: input });
        expect(response.status(), field).toBe(400);
        const body = (await response.json()) as { details?: { fieldErrors?: Record<string, unknown> } };
        expect(Object.keys(body.details?.fieldErrors ?? {}), field).toContain(field);
        // No user was created: the credentials do not log in.
        await expect(loginViaCredentialsApi(api.request, input), field).rejects.toThrow(/failed/);
      }

      // The register form validates before calling the API.
      const register = new RegisterPage(page);
      await register.goto();
      let registerCalls = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/api/auth/register")) registerCalls += 1;
      });
      await register.register(shortPassword);
      await expect(register.password).toHaveAttribute("aria-invalid", "true");
      await expect(register.formError).toBeVisible();
      await register.password.fill(PASSWORD);
      await register.email.fill(badEmail.email);
      await register.submit.click();
      await expect(register.email).toHaveAttribute("aria-invalid", "true");
      expect(registerCalls).toBe(0);
      await expect(page).toHaveURL((url) => url.pathname === "/auth/register");
    },
  );

  test(
    "AUTH-11 a tampered or expired session cookie gets 401 from the API and a redirect from /app",
    { annotation: covers("/api/invoices", "/app/dashboard") },
    async ({ page, context, newApiUser, baseURL }) => {
      const { user } = await newApiUser("auth11");
      const nowSeconds = Math.floor(Date.now() / 1000);
      // The valid control runs last: an open page with a valid session lets
      // next-auth's /api/auth/session poll re-issue a fresh session cookie,
      // which would race with the next cookie swap.
      const cases = [
        {
          label: "tampered: wrong secret",
          token: await mintTamperedSession({ sub: user.id, exp: nowSeconds + 600, secret: "e2e-wrong-secret-0123456789abcdef" }),
          valid: false,
        },
        // next-auth decodes with a 15 s clock tolerance, so expire well before that.
        { label: "expired: exp in the past", token: await mintTamperedSession({ sub: user.id, exp: nowSeconds - 120 }), valid: false },
        { label: "control: valid secret, future exp", token: await mintTamperedSession({ sub: user.id, exp: nowSeconds + 600 }), valid: true },
      ];

      for (const { label, token, valid } of cases) {
        // Leave the app first so no in-flight request can set cookies.
        await page.goto("about:blank");
        await context.clearCookies();
        await context.addCookies([{ name: E2E_SESSION_COOKIE, value: token, url: baseURL! }]);

        const invoices = await page.request.get("/api/invoices", { headers: { "x-forwarded-for": uniqueForwardedFor() } });
        expect(invoices.status(), label).toBe(valid ? 200 : 401);

        await page.goto("/app/dashboard");
        if (valid) {
          await expect(page, label).toHaveURL(/\/app\/dashboard$/);
        } else {
          await expectSignInRedirect(page, "/app/dashboard");
        }
      }
    },
  );
});

test.describe("auth: signed in", () => {
  test(
    "AUTH-06 signing out sends /app/dashboard back to sign-in and GET /api/invoices answers 401",
    { annotation: covers("/app/dashboard", "/api/invoices", "/api/auth/[...nextauth]") },
    async ({ isolatedUser }) => {
      const { page } = isolatedUser;
      await page.goto("/app/dashboard");
      await expect(page.getByRole("heading", { name: "Dashboard invoice" })).toBeVisible();
      expect((await page.request.get("/api/invoices")).status()).toBe(200);

      // AppSidebar SignOutButton, label from lib/i18n (en "Log Out", id "Keluar").
      await page.getByRole("complementary").getByRole("button", { name: /^(Log Out|Keluar)$/ }).click();
      await expect(page).toHaveURL((url) => url.pathname === "/auth/login");

      await page.goto("/app/dashboard");
      await expectSignInRedirect(page, "/app/dashboard");
      expect((await page.request.get("/api/invoices")).status()).toBe(401);
    },
  );

  test(
    "AUTH-12 a signed-in user opening /auth/login is shown the sign-in form (no redirect) and keeps the session",
    { annotation: covers("/auth/login") },
    async ({ isolatedUser }) => {
      // Documented behaviour: /auth/login is outside the middleware matcher
      // (["/app/:path*", "/api/:path*"]) and login-form.tsx never reads the
      // session, so the form renders for a signed-in user.
      const { page, user } = isolatedUser;
      const response = await page.goto("/auth/login");
      expect(response?.status()).toBe(200);
      const login = new LoginPage(page);
      await expect(login.heading).toBeVisible();
      await expect(login.submit).toBeVisible();
      await expect(page).toHaveURL((url) => url.pathname === "/auth/login");
      expect((await getSessionUser(page.request))?.email).toBe(user.email);
    },
  );
});
