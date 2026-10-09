// F2 Security boundaries in the browser: SEC-01, SEC-05, SEC-08
// (plan .plans/e2e-scenarios.md, "F2 Security boundaries").
//
// Verified against the code:
// - app/app/clients/new/ClientFormClient.tsx posts with csrfFetch
//   (lib/security/csrf-client.ts), which echoes the CSRF cookie in x-csrf-token.
// - app/app/invoices/[id]/page.tsx calls notFound() when GET /api/invoices/<id>
//   answers 404 (workspace-scoped findFirst).
// - InvoiceDetailClient renders "Pay Now" for SENT/UNPAID/OVERDUE and always
//   loads Midtrans snap.js from getSnapScriptUrl() (sandbox host for SB-Mid keys);
//   the guards fixture serves it from the stub and records the request.
// - Detail page renders are paced by support/invoice-detail-budget.ts (INV-RL-01).
// - /devtools/perf needs canViewPerfTools: in production only ADMIN_EMAILS
//   (the platformAdmin persona).
import { expect, test, type Guards } from "../../fixtures";
import { E2E_CSRF_COOKIE, CSRF_HEADER_NAME } from "../../support/auth";
import { uniqueEmail } from "../../support/api-factories";
import { gotoInvoiceDetail } from "../../support/invoice-detail-budget";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

test(
  "SEC-01 creating a client through the UI sends x-csrf-token equal to the CSRF cookie and succeeds",
  { tag: "@smoke", annotation: covers("/app/clients/new", "/api/clients") },
  async ({ isolatedUser }) => {
    const { page, context } = isolatedUser;
    await page.goto("/app/clients/new");
    await expect(page.getByRole("heading", { name: "Create New Client" })).toBeVisible();

    const name = `E2E SEC-01 ${Date.now()}`;
    await page.getByPlaceholder("e.g. Acme Corp or John Doe").fill(name);
    await page.locator('input[name="email"]').fill(uniqueEmail("sec01"));

    const createRequest = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/clients" && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Save Client" }).click();
    const request = await createRequest;
    const response = await request.response();
    expect(response?.status()).toBe(201);

    const cookie = (await context.cookies()).find((entry) => entry.name === E2E_CSRF_COOKIE);
    expect(cookie?.value, `${E2E_CSRF_COOKIE} cookie`).toBeTruthy();
    expect(await request.headerValue(CSRF_HEADER_NAME)).toBe(cookie!.value);

    await expect(page).toHaveURL(/\/app\/clients$/);
    await expect(page.getByText(name)).toBeVisible();
  },
);

test(
  "SEC-05 user B gets 404 for user A's invoice page and API",
  { annotation: covers("/app/invoices/[id]", "/api/invoices/[id]") },
  async ({ isolatedUser, newApiUser }) => {
    const owner = await newApiUser("sec05-a");
    const invoice = await owner.factory.createInvoice({ status: "SENT" });

    const { page, api } = isolatedUser;
    expect((await api.get(`/api/invoices/${invoice.id}`)).status()).toBe(404);

    const response = await gotoInvoiceDetail(page, invoice.id);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Detail Invoice" })).toHaveCount(0);
    await expect(page.getByText(invoice.number)).toHaveCount(0);

    // Control: the owner still reads it.
    expect((await owner.api.get(`/api/invoices/${invoice.id}`)).status()).toBe(200);
  },
);

test.describe("SEC-08 no CSP violation and no page error per page", () => {
  const expectClean = async (guards: Guards) => {
    expect(guards.cspViolations, "securitypolicyviolation events").toEqual([]);
    expect(guards.pageErrors.map((error) => error.message), "pageerror events").toEqual([]);
  };

  const pages = [
    { path: "/", heading: /Suite invoicing premium/ },
    { path: "/auth/login", heading: "Masuk ke Invosmart" },
    { path: "/app/dashboard", heading: "Dashboard invoice" },
    { path: "/app/admin/experiments", heading: "Mulai Eksperimen" },
  ] as const;

  for (const { path, heading } of pages) {
    test(`SEC-08 ${path}`, { annotation: covers(path) }, async ({ isolatedUser, guards }) => {
      const { page } = isolatedUser;
      await page.goto(path, { waitUntil: "load" });
      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expectClean(guards);
    });
  }

  test(
    "SEC-08 /app/invoices/[id] with the Midtrans Pay Now button and snap.js",
    { annotation: covers("/app/invoices/[id]") },
    async ({ isolatedUser, guards }) => {
      const { page, factory } = isolatedUser;
      const invoice = await factory.createInvoice({ status: "SENT" });
      await gotoInvoiceDetail(page, invoice.id);
      await expect(page.getByRole("heading", { name: "Detail Invoice" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pay Now" })).toBeVisible();

      // snap.js was requested from the sandbox host (key prefix SB-Mid) and
      // executed under the page's CSP.
      await expect.poll(() => guards.snapRequests).toContain("https://app.sandbox.midtrans.com/snap/snap.js");
      await expect
        .poll(() => page.evaluate(() => typeof (window as unknown as { snap?: { pay?: unknown } }).snap?.pay))
        .toBe("function");
      await expectClean(guards);
    },
  );

  test("SEC-08 /devtools/perf (platform admin)", { annotation: covers("/devtools/perf") }, async ({ persona, guards }) => {
    const { page } = await persona("platformAdmin");
    await page.goto("/devtools/perf", { waitUntil: "load" });
    await expect(page).toHaveURL((url) => url.pathname === "/devtools/perf");
    await expect(page.getByRole("heading", { name: "Performance observability" })).toBeVisible();
    await expectClean(guards);
  });
});
