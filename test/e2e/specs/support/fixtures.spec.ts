import { expect, test } from "../../fixtures";

// Guards for the shared fixtures themselves (plan Step 8).
test.describe("e2e fixtures", () => {
  test("the default page is the owner persona and opens /app/dashboard without logging in", async ({ page }) => {
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard invoice" })).toBeVisible();
  });

  test("persona() opens /app/dashboard without logging in", async ({ persona }) => {
    const viewer = await persona("viewer");
    await viewer.page.goto("/app/dashboard");
    await expect(viewer.page).toHaveURL(/\/app\/dashboard$/);
    await expect(viewer.page.getByRole("heading", { name: "Dashboard invoice" })).toBeVisible();

    const session = await (await viewer.api.get("/api/auth/session")).json();
    expect(session.user.email).toBe(viewer.email);
    const active = (await viewer.factory.listWorkspaces()).find((membership) => membership.active);
    expect(active?.role).toBe("VIEWER");
  });

  test("isolatedUser sees an empty dashboard", async ({ isolatedUser }) => {
    const { page, api, user } = isolatedUser;
    expect(user.workspace.role).toBe("OWNER");

    const invoices = await api.get("/api/invoices");
    expect(invoices.status()).toBe(200);
    expect((await invoices.json()).data).toEqual([]);

    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard invoice" })).toBeVisible();
    await expect(page.getByText("Belum ada invoice yang tersimpan")).toBeVisible();
  });

  test("stub requests are reset before each test", async ({ stub }) => {
    expect(await stub.requests()).toEqual([]);
  });

  test("guards serve the Midtrans snap.js from the stub", async ({ page, guards }) => {
    await page.goto("/app/dashboard");
    await page.evaluate(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = src;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`failed to load ${src}`));
          document.head.appendChild(script);
        }),
      "https://app.sandbox.midtrans.com/snap/snap.js",
    );
    expect(await page.evaluate(() => typeof (window as unknown as { snap?: { pay?: unknown } }).snap?.pay)).toBe("function");
    expect(guards.snapRequests).toEqual(["https://app.sandbox.midtrans.com/snap/snap.js"]);
  });

  test("guards collect securitypolicyviolation events (an app page's CSP blocks the fetch first)", async ({
    page,
    guards,
  }) => {
    await page.goto("/app/dashboard");
    const result = await page.evaluate(() =>
      fetch("https://example.com").then(
        () => "loaded",
        (error: unknown) => `rejected: ${String(error)}`,
      ),
    );
    expect(result).toMatch(/^rejected/);
    await expect.poll(() => guards.cspViolations.map((v) => v.effectiveDirective)).toContain("connect-src");
    expect(guards.cspViolations[0]).toMatchObject({ blockedURI: expect.stringContaining("example.com") });
    // CSP stopped it in the renderer, so no request reached the network guard.
    expect(guards.violations).toEqual([]);
  });

  test("guards abort a browser request to a non-loopback host and record the guard message", async ({
    page,
    guards,
  }) => {
    // about:blank has no CSP, so the request reaches the network layer.
    await page.goto("about:blank");
    const result = await page.evaluate(() =>
      fetch("https://example.com").then(
        () => "loaded",
        (error: unknown) => `rejected: ${String(error)}`,
      ),
    );
    expect(result).toMatch(/^rejected/);
    expect(guards.violations).toEqual([
      "guards: blocked browser request to non-loopback host: GET https://example.com/",
    ]);
    // Cleared so this test passes; the next test shows the teardown failure.
    guards.violations.splice(0);
  });

  test("guards fail the test at teardown on a browser request to a non-loopback host", async ({ page }) => {
    // Expected to fail with "guards: blocked browser request to non-loopback
    // host: GET https://example.com/" (the test above pins the message).
    test.fail();
    await page.goto("about:blank");
    await page.evaluate(() => fetch("https://example.com").catch(() => undefined));
  });

  test("guards record an unexpected 429", async ({ page, stub, guards }) => {
    await stub.force({ target: "/resend/emails", status: 429 });
    // Same-origin fetch on the (loopback) stub, so the request is allowed.
    await page.goto(`${stub.url}/__health`);
    expect(await page.evaluate(() => fetch("/resend/emails", { method: "POST" }).then((r) => r.status))).toBe(429);
    expect(guards.violations).toEqual([
      expect.stringContaining(`guards: unexpected 429 from ${stub.url}/resend/emails (browser;`),
    ]);
    guards.violations.splice(0);
  });

  test("an expects-429 annotation allows a 429", async ({ page, stub, guards }) => {
    test.info().annotations.push({ type: "expects-429" });
    await stub.force({ target: "/resend/emails", status: 429 });
    await page.goto(`${stub.url}/__health`);
    expect(await page.evaluate(() => fetch("/resend/emails", { method: "POST" }).then((r) => r.status))).toBe(429);
    expect(guards.violations).toEqual([]);
  });
});
