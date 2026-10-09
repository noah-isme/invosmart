import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
  E2E_SESSION_COOKIE,
  csrfHeaders,
  getSessionUser,
  loginViaCredentialsApi,
  mintTamperedSession,
  uniqueForwardedFor,
} from "../../support/auth";
import {
  acceptInvitation,
  apiRequest,
  createApiKey,
  createClient,
  createInvoice,
  createReminderRule,
  createSlackEndpoint,
  createTemplate,
  createWorkspace,
  ensureActiveWorkspace,
  inviteMember,
  listWorkspaces,
  payInvoiceViaMidtrans,
  payInvoiceViaStripe,
  registerAndLogin,
  registerUser,
  switchWorkspace,
  uniqueEmail,
} from "../../support/api-factories";

// Guards for the API factories themselves (plan Step 7). Request-only; no page.
test.describe("api factories", () => {
  test("register, log in, create a client and an invoice, pay it via forged Midtrans settlement in < 5 s", async ({
    request,
  }) => {
    const started = performance.now();
    const user = await registerUser(request);
    const session = await loginViaCredentialsApi(request, user);
    await ensureActiveWorkspace(request);
    const client = await createClient(request);
    const invoice = await createInvoice(request, { clientId: client.id, client: client.name, status: "SENT" });
    const paid = await payInvoiceViaMidtrans(request, invoice);
    const elapsedMs = performance.now() - started;
    test.info().annotations.push({ type: "timing", description: `register->pay ${Math.round(elapsedMs)} ms` });
    console.log(`timing: register->login->client->invoice->pay ${Math.round(elapsedMs)} ms`);

    expect(session.email).toBe(user.email);
    expect(paid.attempt.status).toBe("SETTLED");
    expect(paid.attempt.amount).toBe(invoice.total);
    expect(paid.paymentId).toBeTruthy();
    const reread = await apiRequest(request, "GET", `/api/invoices/${invoice.id}`);
    expect(reread.status()).toBe(200);
    expect((await reread.json()).data.status).toBe("PAID");
    expect(elapsedMs).toBeLessThan(5_000);
  });

  test("POST /api/clients is 403 without the CSRF header and 201 with it", async ({ request }) => {
    await registerAndLogin(request);
    const data = { name: "CSRF probe", email: uniqueEmail("csrf") };

    const without = await request.post("/api/clients", { headers: { "x-forwarded-for": uniqueForwardedFor() }, data });
    expect(without.status()).toBe(403);
    expect((await without.json()).error).toBe("Invalid or missing CSRF token");

    const withHeader = await request.post("/api/clients", {
      headers: { "x-forwarded-for": uniqueForwardedFor(), ...(await csrfHeaders(request)) },
      data,
    });
    expect(withHeader.status()).toBe(201);
  });

  test("registrations from one x-forwarded-for are limited; a fresh one still registers", async ({ request }) => {
    test.info().annotations.push({ type: "expects-429" });
    const ip = uniqueForwardedFor();
    const register = () =>
      apiRequest(request, "POST", "/api/auth/register", {
        headers: { "x-forwarded-for": ip },
        data: { name: "Rate Limit", email: uniqueEmail("ratelimit"), password: "E2e-Passw0rd!" },
      });

    // lib/rate-limit.ts: 10 requests per bucket and IP per 60 s window.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await register()).status(), `registration ${attempt}`).toBe(201);
    }
    const limited = await register();
    expect(limited.status()).toBe(429);
    expect(limited.headers()["retry-after"]).toBeTruthy();

    const fresh = await registerUser(request);
    expect(fresh.email).toContain("@invosmart.test");
  });

  test("workspace, template, key, reminder, invitation, Slack and Stripe factories", async ({ request, baseURL }) => {
    const owner = await registerAndLogin(request);
    const second = await createWorkspace(request, { name: "E2E second workspace" });
    expect(second.role).toBe("OWNER");
    expect((await listWorkspaces(request)).find((membership) => membership.active)?.organizationId).toBe(
      second.organizationId,
    );
    expect((await switchWorkspace(request, owner.workspace.organizationId)).organizationId).toBe(
      owner.workspace.organizationId,
    );

    const template = await createTemplate(request);
    expect(template.id).toBeTruthy();

    const { key, token } = await createApiKey(request, second.organizationId, {
      scopes: ["invoices:read"],
      expiresInDays: 30,
    });
    expect(token.startsWith(`inv_live_`)).toBe(true);
    expect(key.scopes).toEqual(["invoices:read"]);

    const rule = await createReminderRule(request, owner.workspace.organizationId, { channels: ["EMAIL"] });
    expect(rule.channels).toEqual(["EMAIL"]);

    const slack = await createSlackEndpoint(request, second.organizationId);
    expect(slack).toMatchObject({ type: "SLACK", enabled: true });
    expect(JSON.stringify(slack)).not.toContain("hooks.slack.com");

    const inviteeContext = await playwrightRequest.newContext({ baseURL });
    try {
      const invitee = await registerAndLogin(inviteeContext);
      const { token: inviteToken } = await inviteMember(request, owner.workspace.organizationId, {
        email: invitee.email,
        role: "MEMBER",
      });
      const membership = await acceptInvitation(inviteeContext, inviteToken);
      expect(membership).toMatchObject({ organizationId: owner.workspace.organizationId, role: "MEMBER" });
      expect((await getSessionUser(inviteeContext))?.email).toBe(invitee.email);
    } finally {
      await inviteeContext.dispose();
    }

    const manuallyPaid = await createInvoice(request, { status: "PAID" });
    expect(manuallyPaid.status).toBe("PAID");
    const overdue = await createInvoice(request, { status: "SENT", dueAt: new Date(Date.now() - 2 * 86_400_000) });
    const overdueRead = await apiRequest(request, "GET", `/api/invoices/${overdue.id}`);
    expect((await overdueRead.json()).data.status).toBe("OVERDUE");

    const invoice = await createInvoice(request, { status: "SENT" });
    const paid = await payInvoiceViaStripe(request, invoice);
    expect(paid.attempt).toMatchObject({ provider: "stripe", status: "SETTLED", amount: invoice.total });
    expect(paid.paymentId).toBeTruthy();
  });

  test("mintTamperedSession: valid secret is accepted, wrong secret or past exp is not", async ({ request, baseURL }) => {
    const { id: sub } = await registerAndLogin(request);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionWith = async (token: string) => {
      const context = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        const response = await context.get("/api/auth/session", {
          headers: { "x-forwarded-for": uniqueForwardedFor(), cookie: `${E2E_SESSION_COOKIE}=${token}` },
        });
        expect(response.status()).toBe(200);
        return ((await response.json()) as { user?: { id?: string } }).user?.id ?? null;
      } finally {
        await context.dispose();
      }
    };

    // Control: same helper, correct secret, future exp -> next-auth decodes it.
    expect(await sessionWith(await mintTamperedSession({ sub, exp: nowSeconds + 600 }))).toBe(sub);
    expect(await sessionWith(await mintTamperedSession({ sub, exp: nowSeconds + 600, secret: "wrong-secret" }))).toBeNull();
    expect(await sessionWith(await mintTamperedSession({ sub, exp: nowSeconds - 60 }))).toBeNull();
  });
});
