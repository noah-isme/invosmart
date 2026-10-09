// F2 Security boundaries, request-only: SEC-02, SEC-03, SEC-04, SEC-07,
// SEC-09, SEC-10 (plan .plans/e2e-scenarios.md, "F2 Security boundaries").
//
// Verified against middleware.ts and lib/security/csrf.ts:
// - Every POST/PUT/PATCH/DELETE under /api/* except /api/auth/* needs the
//   x-csrf-token header equal to the __Host-csrf-token cookie, else 403
//   { error: "Invalid or missing CSRF token" }.
// - Exempt: POST to exactly /api/payments/stripe/webhook,
//   /api/payments/midtrans/notification, /api/webhooks/resend (signature
//   checked by the route), and /api/v1/* with `Authorization: Bearer inv_live_*`
//   (the API-key layer answers).
// - Signature failures: Stripe 400 "Invalid signature", Midtrans 403
//   "Invalid signature" (same status as CSRF, so the body tells them apart),
//   Resend 400 "Invalid webhook signature".
import { expect, test, type ApiUser } from "../../fixtures";
import { midtransNotification, uniqueEmail } from "../../support/api-factories";
import { CSRF_HEADER_NAME, E2E_CSRF_COOKIE, csrfHeaders, uniqueForwardedFor } from "../../support/auth";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));
const CSRF_ERROR = "Invalid or missing CSRF token";

/** A request with the session cookie but without (or with a chosen) CSRF header. */
const rawPost = (owner: ApiUser, url: string, data: unknown, headers: Record<string, string> = {}) =>
  owner.api.request.post(url, { headers: { "x-forwarded-for": uniqueForwardedFor(), ...headers }, data });

const errorOf = async (response: import("@playwright/test").APIResponse) =>
  ((await response.json().catch(() => ({}))) as { error?: unknown }).error;

test(
  "SEC-02 POST /api/clients with a session but no CSRF header is 403",
  { tag: "@smoke", annotation: covers("/api/clients") },
  async ({ newApiUser }) => {
    const owner = await newApiUser("sec02");
    const response = await rawPost(owner, "/api/clients", { name: "SEC-02", email: uniqueEmail("sec02") });
    expect(response.status()).toBe(403);
    expect(await errorOf(response)).toBe(CSRF_ERROR);

    // Nothing was created.
    const list = await owner.api.get("/api/clients");
    expect(JSON.stringify(await list.json())).not.toContain("SEC-02");
  },
);

test(
  "SEC-03 a mismatched CSRF header is 403; the matching pair reaches the route (201 or 400, never 403)",
  { annotation: covers("/api/clients") },
  async ({ newApiUser, playwright, baseURL }) => {
    const owner = await newApiUser("sec03");
    const { [CSRF_HEADER_NAME]: token } = await csrfHeaders(owner.api.request);
    expect(token).toBeTruthy();

    const mismatched = await rawPost(owner, "/api/clients", { name: "SEC-03 mismatch" }, { [CSRF_HEADER_NAME]: `${token}x` });
    expect(mismatched.status()).toBe(403);
    expect(await errorOf(mismatched)).toBe(CSRF_ERROR);


    const valid = await rawPost(owner, "/api/clients", { name: "SEC-03 ok", email: uniqueEmail("sec03") }, {
      [CSRF_HEADER_NAME]: token,
    });
    expect(valid.status()).toBe(201);

    // The header alone, from a context without the cookie, is refused too.
    const cookieless = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const headerOnly = await cookieless.post("/api/clients", {
        headers: { "x-forwarded-for": uniqueForwardedFor(), [CSRF_HEADER_NAME]: token },
        data: { name: "SEC-03 header only" },
      });
      expect(headerOnly.status()).toBe(403);
      expect(await errorOf(headerOnly)).toBe(CSRF_ERROR);
    } finally {
      await cookieless.dispose();
    }

    // Correct pair, invalid body: the route's own validation answers.
    const invalid = await rawPost(owner, "/api/clients", { name: "" }, { [CSRF_HEADER_NAME]: token });
    expect(invalid.status()).toBe(400);
  },
);

test(
  "SEC-04 GET /api/invoices without a session is 401",
  { annotation: covers("/api/invoices") },
  async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const response = await anonymous.get("/api/invoices", { headers: { "x-forwarded-for": uniqueForwardedFor() } });
      expect(response.status()).toBe(401);
      // The middleware still issues the CSRF cookie on the way out.
      const state = await anonymous.storageState();
      expect(state.cookies.map((cookie) => cookie.name)).toContain(E2E_CSRF_COOKIE);
    } finally {
      await anonymous.dispose();
    }
  },
);

test(
  "SEC-07 Bearer inv_live_* on /api/v1/invoices without CSRF reaches the API-key layer (401), not CSRF 403",
  { annotation: covers("/api/v1/invoices") },
  async ({ playwright, baseURL }) => {
    const client = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      const headers = { authorization: "Bearer inv_live_e2e_unknown_key_0000000000", "x-forwarded-for": uniqueForwardedFor() };
      const post = await client.post("/api/v1/invoices", { headers, data: { client: "SEC-07", items: [] } });
      expect(post.status()).toBe(401);
      expect(await errorOf(post)).not.toBe(CSRF_ERROR);

      const get = await client.get("/api/v1/invoices", { headers: { ...headers, "x-forwarded-for": uniqueForwardedFor() } });
      expect(get.status()).toBe(401);

      // Without the bearer prefix the CSRF layer answers first.
      const noBearer = await client.post("/api/v1/invoices", {
        headers: { "x-forwarded-for": uniqueForwardedFor() },
        data: { client: "SEC-07", items: [] },
      });
      expect(noBearer.status()).toBe(403);
      expect(await errorOf(noBearer)).toBe(CSRF_ERROR);
    } finally {
      await client.dispose();
    }
  },
);

test.describe("SEC-09 signed webhooks are exempt from CSRF and answer their own signature failure", () => {
  const webhooks = [
    {
      path: "/api/payments/stripe/webhook",
      expected: { status: 400, error: "Invalid signature" },
      body: () => JSON.stringify({ id: "evt_e2e_bad", type: "checkout.session.completed", data: { object: {} } }),
      headers: (): Record<string, string> => ({ "stripe-signature": "t=1700000000,v1=deadbeef" }),
    },
    {
      path: "/api/payments/midtrans/notification",
      expected: { status: 403, error: "Invalid signature" },
      body: () =>
        JSON.stringify(
          midtransNotification({ orderId: `INV-E2E-SEC09-${Date.now()}`, grossAmount: 1000, serverKey: "SB-Mid-server-wrong" }),
        ),
      headers: (): Record<string, string> => ({}),
    },
    {
      path: "/api/webhooks/resend",
      expected: { status: 400, error: "Invalid webhook signature" },
      body: () => JSON.stringify({ type: "email.delivered", data: { email_id: "e2e-sec09" } }),
      headers: (): Record<string, string> => ({
        "svix-id": "msg_e2e_sec09",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,ZTJlLWJhZC1zaWduYXR1cmU=",
      }),
    },
  ];

  for (const webhook of webhooks) {
    test(`SEC-09 ${webhook.path}`, { annotation: covers(webhook.path) }, async ({ playwright, baseURL }) => {
      // A provider has no session and no CSRF cookie.
      const provider = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        const response = await provider.post(webhook.path, {
          headers: { "content-type": "application/json", "x-forwarded-for": uniqueForwardedFor(), ...webhook.headers() },
          data: webhook.body(),
        });
        expect(response.status()).toBe(webhook.expected.status);
        const error = await errorOf(response);
        expect(error).toBe(webhook.expected.error);
        expect(error).not.toBe(CSRF_ERROR);
        // Exempt routes do not mint a CSRF cookie.
        expect((await provider.storageState()).cookies.map((cookie) => cookie.name)).not.toContain(E2E_CSRF_COOKIE);
      } finally {
        await provider.dispose();
      }
    });
  }
});

test.describe("SEC-10 other /api POSTs without CSRF are 403", () => {
  const routes = [
    { path: "/api/payments/midtrans/create", covers: "/api/payments/midtrans/create", data: { invoiceId: "sec10" } },
    { path: "/api/payments/stripe/create-session", covers: "/api/payments/stripe/create-session", data: { invoiceId: "sec10" } },
    { path: "/api/invoices", covers: "/api/invoices", data: { client: "SEC-10", items: [] } },
    { path: "/api/workspaces/switch", covers: "/api/workspaces/switch", data: { organizationId: "sec10" } },
    // Exact-path exemption only: a path below a webhook path is protected.
    { path: "/api/payments/stripe/webhook/replay", covers: "/api/payments/stripe/webhook", data: {} },
  ];

  for (const route of routes) {
    test(`SEC-10 POST ${route.path}`, { annotation: covers(route.covers) }, async ({ newApiUser }) => {
      const owner = await newApiUser("sec10");
      const response = await rawPost(owner, route.path, route.data);
      expect(response.status()).toBe(403);
      expect(await errorOf(response)).toBe(CSRF_ERROR);
    });
  }

  test("SEC-10 PUT to a webhook path is not exempt", { annotation: covers("/api/payments/stripe/webhook") }, async ({ newApiUser }) => {
    const owner = await newApiUser("sec10-put");
    const response = await owner.api.request.put("/api/payments/stripe/webhook", {
      headers: { "x-forwarded-for": uniqueForwardedFor() },
      data: {},
    });
    expect(response.status()).toBe(403);
    expect(await errorOf(response)).toBe(CSRF_ERROR);
  });
});
