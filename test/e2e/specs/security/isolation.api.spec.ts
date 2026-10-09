// F2 Security boundaries, cross-workspace isolation: SEC-06 and the SEC-11
// per-resource verb matrix (plan .plans/e2e-scenarios.md, "F2 Security boundaries").
//
// Workspace A belongs to user A; user B is a separate user who owns only its
// own workspace B. Every resource is created in A through the real API.
//
// Verified against the route files (only verbs that exist are listed):
// - Resources looked up by id inside the caller's resolved workspace
//   (invoice, client, template, receipt, payment attempt, experiment) answer
//   404 for another workspace's id.
// - Routes under /api/workspaces/<orgId>/... resolve the membership for the
//   path's orgId; a non-member gets 404 "Workspace not found" / "... not found"
//   (lib/workspaces.ts resolveWorkspaceContext returns null). B using its own
//   workspace path with A's sub-resource id also gets 404.
// - Asking for another workspace explicitly (x-organization-id or
//   ?organizationId=, lib/workspaces.ts getRequestedOrganizationId) gives
//   403 "Workspace access denied" (SEC-06), as does ?tenantId=<orgA> on the
//   audit-log list.
// - Mutating rows are followed by an owner read proving A's row is intact.
// - Global resources (feature flags, /api/ai/explain) are platform-admin only:
//   ADMIN_USER_IDS (session user id), never workspace OWNER/ADMIN
//   (lib/devtools/access.ts). The platformAdmin persona is the only admin; its
//   User row is pre-seeded with E2E_PLATFORM_ADMIN_ID (ADMIN_EMAILS is ignored).
import type { APIRequestContext, APIResponse, PlaywrightWorkerArgs, TestInfo } from "@playwright/test";

import { expect, test } from "../../fixtures";
import { E2E_APP_URL, E2E_PERSONA_PASSWORD, E2E_PERSONAS, E2E_PLATFORM_ADMIN_ID } from "../../playwright.env";
import { loginViaCredentialsApi } from "../../support/auth";
import {
  apiRequest,
  createApiKey,
  createClient,
  createExperiment,
  createInvoice,
  createReceipt,
  createReminderRule,
  createSlackEndpoint,
  createTemplate,
  inviteMember,
  payInvoiceViaMidtrans,
  registerAndLogin,
  uniqueEmail,
  type ClientRecord,
  type InvoiceRecord,
  type LoggedInUser,
} from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

type World = {
  a: { request: APIRequestContext; user: LoggedInUser; org: string };
  b: { request: APIRequestContext; user: LoggedInUser; org: string };
  invoice: InvoiceRecord;
  client: ClientRecord;
  templateId: string;
  receiptId: string;
  attemptId: string;
  apiKeyId: string;
  ruleId: string;
  slackId: string;
  invitationEmail: string;
  experimentId: number;
  /** Every id of A's that must never appear in B's responses. */
  aIds: string[];
  bInvoice: InvoiceRecord;
};

let world: World;

/**
 * A request context logged in as the platformAdmin persona. Its User row is
 * pre-seeded with the fixed id E2E_PLATFORM_ADMIN_ID before the app starts
 * (support/db/seed-platform-admin.mjs) and the app gets
 * ADMIN_USER_IDS=E2E_PLATFORM_ADMIN_ID. The `api` project does not depend on
 * the setup project, so this logs in directly instead of using a storageState.
 */
async function platformAdminRequest(playwright: PlaywrightWorkerArgs["playwright"], testInfo: TestInfo): Promise<APIRequestContext> {
  const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? E2E_APP_URL;
  const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const session = await loginViaCredentialsApi(request, { email: E2E_PERSONAS.platformAdmin, password: E2E_PERSONA_PASSWORD });
  expect(session.id).toBe(E2E_PLATFORM_ADMIN_ID);
  return request;
}

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? E2E_APP_URL;
  const newUser = async (tag: string) => {
    const request = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const user = await registerAndLogin(request, { email: uniqueEmail(tag) });
    return { request, user, org: user.workspace.organizationId };
  };
  const a = await newUser("sec11-a");
  const b = await newUser("sec11-b");

  const client = await createClient(a.request);
  const invoice = await createInvoice(a.request, { clientId: client.id, client: client.name, status: "SENT" });
  const paidInvoice = await createInvoice(a.request, { status: "SENT" });
  const paid = await payInvoiceViaMidtrans(a.request, paidInvoice);
  const receipt = await createReceipt(a.request, paid.paymentId);
  const template = await createTemplate(a.request);
  const { key } = await createApiKey(a.request, a.org, { scopes: ["invoices:read"] });
  // EMAIL-only rule with due dates a week out: no delivery is due during the run.
  const rule = await createReminderRule(a.request, a.org, { channels: ["EMAIL"] });
  const slack = await createSlackEndpoint(a.request, a.org, { enabled: false });
  const invitationEmail = uniqueEmail("sec11-invitee");
  await inviteMember(a.request, a.org, { email: invitationEmail, role: "MEMBER" });
  const experiment = await createExperiment(a.request);
  const bInvoice = await createInvoice(b.request, { status: "SENT" });

  world = {
    a,
    b,
    invoice,
    client,
    templateId: template.id,
    receiptId: receipt.receiptId,
    attemptId: paid.attemptId,
    apiKeyId: key.id,
    ruleId: rule.id,
    slackId: slack.id,
    invitationEmail,
    experimentId: experiment.experiment.id,
    aIds: [
      a.org,
      a.user.id,
      // Invoice numbers are per-workspace sequences (lib/schemas.ts
      // generateInvoiceNumber) and collide across workspaces; client names
      // are unique per test and identify A's invoices instead.
      invoice.id,
      paidInvoice.id,
      paidInvoice.client,
      client.id,
      client.name,
      template.id,
      receipt.receiptId,
      paid.attemptId,
      paid.paymentId,
      key.id,
      rule.id,
      slack.id,
      invitationEmail,
    ],
    bInvoice,
  };
});

test.afterAll(async () => {
  await world?.a.request.dispose();
  await world?.b.request.dispose();
});

const asB = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, options: Parameters<typeof apiRequest>[3] = {}) =>
  apiRequest(world.b.request, method, url, options);
const asA = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, options: Parameters<typeof apiRequest>[3] = {}) =>
  apiRequest(world.a.request, method, url, options);

async function expectStatus(response: APIResponse, expected: number, label: string) {
  if (response.status() !== expected) {
    const body = await response.text().catch(() => "");
    expect(response.status(), `${label}: ${body.slice(0, 300)}`).toBe(expected);
  }
}

function expectNoneOfA(body: string, label: string) {
  for (const id of world.aIds) {
    expect(body, `${label} leaks ${id}`).not.toContain(id);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Row = {
  resource: string;
  method: Method;
  /** The route file this row exercises (for @covers). */
  route: string;
  url: (w: World) => string;
  data?: (w: World) => unknown;
  expected: 403 | 404;
  /** For mutating rows: an owner (A) read that must still answer 200 afterwards. */
  ownerCheck?: (w: World) => string;
};

const invoicePutBody = (w: World) => {
  const invoice = w.invoice;
  return {
    id: invoice.id,
    client: invoice.client,
    clientId: invoice.clientId,
    items: invoice.items,
    taxRate: invoice.subtotal > 0 ? invoice.tax / invoice.subtotal : 0,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    total: invoice.total,
    status: "PAID",
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    notes: "SEC-11 tampered by B",
    currency: invoice.currency,
  };
};

// The per-resource verb table. 404 = "not found in your workspace"; there is
// no workspace-collection route that answers 403 to a plain non-member (the
// explicit-workspace 403s are in SEC-06 below).
// Static mirror of the computed covers() argument below for scripts/e2e-coverage-check.mjs; keep in sync.
// @covers: /api/invoices/[id], /api/invoices/[id]/pdf, /api/invoices/[id]/send-email, /api/clients/[id]
// @covers: /api/invoices/templates/[id], /api/invoices/templates/[id]/instantiate, /api/receipts/[id]/pdf
// @covers: /api/receipts/[id]/audit, /api/payments/[attemptId], /api/workspaces/[id]/api-keys/[keyId]
// @covers: /api/workspaces/[id]/reminder-rules/[ruleId], /api/workspaces/[id]/notifications/[endpointId]
// @covers: /api/workspaces/[id]/invitations, /api/workspaces/[id]/members, /api/workspaces/[id]/api-keys
// @covers: /api/workspaces/[id]/reminder-rules, /api/workspaces/[id]/notifications, /api/opt/variants/[experimentId]
const ROWS: Row[] = [
  // Invoice
  { resource: "invoice", method: "GET", route: "/api/invoices/[id]", url: (w) => `/api/invoices/${w.invoice.id}`, expected: 404 },
  {
    resource: "invoice",
    method: "PUT",
    route: "/api/invoices/[id]",
    url: (w) => `/api/invoices/${w.invoice.id}`,
    data: invoicePutBody,
    expected: 404,
    ownerCheck: (w) => `/api/invoices/${w.invoice.id}`,
  },
  {
    resource: "invoice",
    method: "DELETE",
    route: "/api/invoices/[id]",
    url: (w) => `/api/invoices/${w.invoice.id}`,
    expected: 404,
    ownerCheck: (w) => `/api/invoices/${w.invoice.id}`,
  },
  { resource: "invoice pdf", method: "GET", route: "/api/invoices/[id]/pdf", url: (w) => `/api/invoices/${w.invoice.id}/pdf`, expected: 404 },
  {
    resource: "invoice send-email",
    method: "POST",
    route: "/api/invoices/[id]/send-email",
    url: (w) => `/api/invoices/${w.invoice.id}/send-email`,
    data: () => ({ to: "sec11-attacker@invosmart.test" }),
    expected: 404,
  },
  // Client
  { resource: "client", method: "GET", route: "/api/clients/[id]", url: (w) => `/api/clients/${w.client.id}`, expected: 404 },
  {
    resource: "client",
    method: "PUT",
    route: "/api/clients/[id]",
    url: (w) => `/api/clients/${w.client.id}`,
    data: () => ({ name: "SEC-11 tampered by B", currency: "IDR" }),
    expected: 404,
    ownerCheck: (w) => `/api/clients/${w.client.id}`,
  },
  {
    resource: "client",
    method: "DELETE",
    route: "/api/clients/[id]",
    url: (w) => `/api/clients/${w.client.id}`,
    expected: 404,
    ownerCheck: (w) => `/api/clients/${w.client.id}`,
  },
  // Template
  {
    resource: "template",
    method: "GET",
    route: "/api/invoices/templates/[id]",
    url: (w) => `/api/invoices/templates/${w.templateId}`,
    expected: 404,
  },
  {
    resource: "template",
    method: "PUT",
    route: "/api/invoices/templates/[id]",
    url: (w) => `/api/invoices/templates/${w.templateId}`,
    data: () => ({ name: "SEC-11 tampered by B" }),
    expected: 404,
    ownerCheck: (w) => `/api/invoices/templates/${w.templateId}`,
  },
  {
    resource: "template",
    method: "DELETE",
    route: "/api/invoices/templates/[id]",
    url: (w) => `/api/invoices/templates/${w.templateId}`,
    expected: 404,
    ownerCheck: (w) => `/api/invoices/templates/${w.templateId}`,
  },
  {
    resource: "template instantiate",
    method: "POST",
    route: "/api/invoices/templates/[id]/instantiate",
    url: (w) => `/api/invoices/templates/${w.templateId}/instantiate`,
    data: () => ({}),
    expected: 404,
  },
  // Receipt
  { resource: "receipt pdf", method: "GET", route: "/api/receipts/[id]/pdf", url: (w) => `/api/receipts/${w.receiptId}/pdf`, expected: 404 },
  {
    resource: "receipt audit",
    method: "GET",
    route: "/api/receipts/[id]/audit",
    url: (w) => `/api/receipts/${w.receiptId}/audit`,
    expected: 404,
  },
  // Payment attempt
  {
    resource: "payment attempt",
    method: "GET",
    route: "/api/payments/[attemptId]",
    url: (w) => `/api/payments/${w.attemptId}`,
    expected: 404,
  },
  // API key: A's workspace path (non-member) and B's own path with A's key id.
  ...(["GET", "PATCH", "DELETE"] as const).flatMap((method): Row[] =>
    [
      { path: "A", org: (w: World) => w.a.org },
      { path: "B", org: (w: World) => w.b.org },
    ].map(({ path, org }) => ({
      resource: `api key (${path} path)`,
      method,
      route: "/api/workspaces/[id]/api-keys/[keyId]",
      url: (w) => `/api/workspaces/${org(w)}/api-keys/${w.apiKeyId}`,
      data: method === "PATCH" ? () => ({ name: "SEC-11 tampered by B" }) : undefined,
      expected: 404,
      ownerCheck: method === "GET" ? undefined : (w) => `/api/workspaces/${w.a.org}/api-keys/${w.apiKeyId}`,
    })),
  ),
  // Reminder rule
  ...(["PATCH", "DELETE"] as const).flatMap((method): Row[] =>
    [
      { path: "A", org: (w: World) => w.a.org },
      { path: "B", org: (w: World) => w.b.org },
    ].map(({ path, org }) => ({
      resource: `reminder rule (${path} path)`,
      method,
      route: "/api/workspaces/[id]/reminder-rules/[ruleId]",
      url: (w) => `/api/workspaces/${org(w)}/reminder-rules/${w.ruleId}`,
      data: method === "PATCH" ? () => ({ enabled: false }) : undefined,
      expected: 404,
    })),
  ),
  // Slack endpoint
  ...(["PATCH", "DELETE"] as const).flatMap((method): Row[] =>
    [
      { path: "A", org: (w: World) => w.a.org },
      { path: "B", org: (w: World) => w.b.org },
    ].map(({ path, org }) => ({
      resource: `slack endpoint (${path} path)`,
      method,
      route: "/api/workspaces/[id]/notifications/[endpointId]",
      url: (w) => `/api/workspaces/${org(w)}/notifications/${w.slackId}`,
      data: method === "PATCH" ? () => ({ enabled: true }) : undefined,
      expected: 404,
    })),
  ),
  // Workspace-scoped collections under A's path
  {
    resource: "invitation list",
    method: "GET",
    route: "/api/workspaces/[id]/invitations",
    url: (w) => `/api/workspaces/${w.a.org}/invitations`,
    expected: 404,
  },
  { resource: "member list", method: "GET", route: "/api/workspaces/[id]/members", url: (w) => `/api/workspaces/${w.a.org}/members`, expected: 404 },
  { resource: "api key list", method: "GET", route: "/api/workspaces/[id]/api-keys", url: (w) => `/api/workspaces/${w.a.org}/api-keys`, expected: 404 },
  {
    resource: "reminder rule list",
    method: "GET",
    route: "/api/workspaces/[id]/reminder-rules",
    url: (w) => `/api/workspaces/${w.a.org}/reminder-rules`,
    expected: 404,
  },
  {
    resource: "notification list",
    method: "GET",
    route: "/api/workspaces/[id]/notifications",
    url: (w) => `/api/workspaces/${w.a.org}/notifications`,
    expected: 404,
  },
  // Experiment
  {
    resource: "experiment variants",
    method: "GET",
    route: "/api/opt/variants/[experimentId]",
    url: (w) => `/api/opt/variants/${w.experimentId}`,
    expected: 404,
  },
];

test.describe("SEC-11 cross-workspace verb matrix", () => {
  for (const row of ROWS) {
    test(`SEC-11 ${row.resource} ${row.method} -> ${row.expected}`, { annotation: covers(row.route) }, async () => {
      const response = await asB(row.method, row.url(world), row.data ? { data: row.data(world) } : {});
      await expectStatus(response, row.expected, `${row.method} ${row.url(world)}`);
      expectNoneOfA(await response.text(), `${row.method} ${row.url(world)}`);

      if (row.ownerCheck) {
        const owner = await asA("GET", row.ownerCheck(world));
        await expectStatus(owner, 200, `owner re-read ${row.ownerCheck(world)}`);
        const body = await owner.text();
        expect(body, "A's row was not modified by B").not.toContain("SEC-11 tampered by B");
      }
    });
  }

  test("SEC-11 the owner (control) reads every resource in the matrix", { annotation: covers("/api/invoices/[id]") }, async () => {
    for (const url of [
      `/api/invoices/${world.invoice.id}`,
      `/api/clients/${world.client.id}`,
      `/api/invoices/templates/${world.templateId}`,
      `/api/receipts/${world.receiptId}/audit`,
      `/api/payments/${world.attemptId}`,
      `/api/workspaces/${world.a.org}/api-keys/${world.apiKeyId}`,
      `/api/workspaces/${world.a.org}/invitations`,
      `/api/opt/variants/${world.experimentId}`,
    ]) {
      await expectStatus(await asA("GET", url), 200, `owner GET ${url}`);
    }
    const rules = await (await asA("GET", `/api/workspaces/${world.a.org}/reminder-rules`)).text();
    expect(rules).toContain(world.ruleId);
    const endpoints = await (await asA("GET", `/api/workspaces/${world.a.org}/notifications`)).text();
    expect(endpoints).toContain(world.slackId);
    const invitations = await (await asA("GET", `/api/workspaces/${world.a.org}/invitations`)).text();
    expect(invitations).toContain(world.invitationEmail);
  });

  // Static mirror of the computed covers() argument below for scripts/e2e-coverage-check.mjs; keep in sync.
  // @covers: /api/invoices, /api/clients, /api/invoices/templates, /api/payments, /api/opt/experiments, /api/workspaces
  const LISTS = [
    { route: "/api/invoices", url: "/api/invoices" },
    { route: "/api/clients", url: "/api/clients" },
    { route: "/api/invoices/templates", url: "/api/invoices/templates" },
    { route: "/api/payments", url: "/api/payments" },
    { route: "/api/opt/experiments", url: "/api/opt/experiments" },
    { route: "/api/workspaces", url: "/api/workspaces" },
  ];
  for (const list of LISTS) {
    test(`SEC-11 B's list ${list.url} never includes A's rows`, { annotation: covers(list.route) }, async () => {
      const response = await asB("GET", list.url);
      await expectStatus(response, 200, `GET ${list.url}`);
      const body = await response.text();
      expectNoneOfA(body, `GET ${list.url}`);
      if (list.url === "/api/invoices") expect(body).toContain(world.bInvoice.id);
      if (list.url === "/api/opt/experiments") {
        const ids = ((JSON.parse(body) as { experiments: Array<{ experiment: { id: number } }> }).experiments ?? []).map(
          (entry) => entry.experiment.id,
        );
        expect(ids).not.toContain(world.experimentId);
      }
    });
  }

  test("SEC-11 B's invoice export (CSV) never includes A's rows", { annotation: covers("/api/invoices/export") }, async () => {
    const response = await asB("GET", "/api/invoices/export?format=csv");
    await expectStatus(response, 200, "GET /api/invoices/export");
    const csv = await response.text();
    expect(csv).toContain(world.bInvoice.client);
    expectNoneOfA(csv, "export csv");
  });

  // Static mirror of the computed covers() argument below for scripts/e2e-coverage-check.mjs; keep in sync.
  // @covers: /api/admin/audit-logs, /api/admin/audit-log
  for (const route of ["/api/admin/audit-logs", "/api/admin/audit-log"]) {
    test(`SEC-11 B's audit log list ${route} never includes A's rows`, { annotation: covers(route) }, async () => {
      // A's actions are recorded under A's workspace (control, async writes).
      await expect
        .poll(async () => {
          const own = (await (await asA("GET", `${route}?limit=100`)).json()) as { logs?: Array<{ tenantId: string | null }> };
          return (own.logs ?? []).filter((log) => log.tenantId === world.a.org).length;
        })
        .toBeGreaterThan(0);

      const response = await asB("GET", `${route}?limit=100`);
      await expectStatus(response, 200, `GET ${route}`);
      const body = (await response.json()) as { logs: Array<{ tenantId: string | null; userId: string | null }> };
      for (const log of body.logs) {
        expect(log.tenantId).not.toBe(world.a.org);
        expect(log.userId).not.toBe(world.a.user.id);
      }
      expectNoneOfA(JSON.stringify(body), `GET ${route}`);

      // Asking for A's tenant explicitly is refused.
      await expectStatus(await asB("GET", `${route}?tenantId=${world.a.org}`), 403, `GET ${route}?tenantId=<A>`);
    });
  }

  test(
    "SEC-11 FeatureFlag: a workspace OWNER who is not a platform admin cannot change global flags; the platform admin can",
    { annotation: covers("/api/admin/feature-flags") },
    async ({ playwright }, testInfo) => {
      // Global flags are gated on platform admin (ADMIN_USER_IDS), never on
      // workspace role (app/api/admin/feature-flags/route.ts, fixed on main by
      // fix/admin-access-by-user-id). B owns workspace B and is still refused.
      const key = `e2e_sec11_${Date.now()}`;
      const create = await asB("POST", "/api/admin/feature-flags", { data: { key, name: "SEC-11 probe", enabled: false } });
      await expectStatus(create, 403, "POST /api/admin/feature-flags as workspace OWNER");
      await expectStatus(await asB("GET", "/api/admin/feature-flags"), 403, "GET /api/admin/feature-flags as workspace OWNER");

      // Control: the pre-seeded platformAdmin persona (E2E_PLATFORM_ADMIN_ID).
      const admin = await platformAdminRequest(playwright, testInfo);
      try {
        const created = await apiRequest(admin, "POST", "/api/admin/feature-flags", { data: { key, name: "SEC-11 probe", enabled: false } });
        await expectStatus(created, 201, "POST /api/admin/feature-flags as platform admin");
        const flag = ((await created.json()) as { flag: { id: string; key: string; enabled: boolean } }).flag;
        expect(flag).toMatchObject({ key, enabled: false });
        const toggled = await apiRequest(admin, "POST", "/api/admin/feature-flags", { data: { id: flag.id, enabled: true } });
        await expectStatus(toggled, 200, "toggle as platform admin");
        expect(((await toggled.json()) as { flag: { enabled: boolean } }).flag.enabled).toBe(true);
        // B still cannot toggle or delete the existing flag.
        await expectStatus(await asB("POST", "/api/admin/feature-flags", { data: { id: flag.id, enabled: false } }), 403, "toggle as OWNER");
        await expectStatus(await asB("DELETE", `/api/admin/feature-flags?id=${flag.id}`), 403, "delete as OWNER");
        await expectStatus(await apiRequest(admin, "DELETE", `/api/admin/feature-flags?id=${flag.id}`), 200, "delete as platform admin");
      } finally {
        await admin.dispose();
      }
    },
  );
});

test.describe("SEC-12 platform-admin gates (ADMIN_USER_IDS, not workspace role)", () => {
  test(
    "SEC-12 /api/ai/explain is platform-admin only: anonymous 401, workspace OWNER 403, platform admin passes the gate",
    { annotation: covers("/api/ai/explain") },
    async ({ playwright }, testInfo) => {
      const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? E2E_APP_URL;
      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      const admin = await platformAdminRequest(playwright, testInfo);
      try {
        await expectStatus(await apiRequest(anonymous, "POST", "/api/ai/explain", { data: { recommendation_id: "x" } }), 401, "anonymous");
        const owner = await asB("POST", "/api/ai/explain", { data: { recommendation_id: "x" } });
        await expectStatus(owner, 403, "workspace OWNER");
        // Past the gate an empty body is a validation error (no model call is made).
        await expectStatus(await apiRequest(admin, "POST", "/api/ai/explain", { data: {} }), 400, "platform admin, invalid body");
      } finally {
        await anonymous.dispose();
        await admin.dispose();
      }
    },
  );

  test(
    "SEC-12 /api/ai-optimizer/recommendations exposes only route and confidence",
    { annotation: covers("/api/ai-optimizer/recommendations") },
    async ({ playwright }, testInfo) => {
      const baseURL = (testInfo.project.use.baseURL as string | undefined) ?? E2E_APP_URL;
      const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
      try {
        const response = await apiRequest(anonymous, "GET", "/api/ai-optimizer/recommendations");
        await expectStatus(response, 200, "GET /api/ai-optimizer/recommendations");
        const body = (await response.json()) as { recommendations: Array<Record<string, unknown>> };
        expect(Object.keys(body)).toEqual(["recommendations"]);
        for (const entry of body.recommendations) {
          expect(Object.keys(entry).sort()).toEqual(["confidence", "route"]);
        }
      } finally {
        await anonymous.dispose();
      }
    },
  );
});

test.describe("SEC-06 asking for another workspace explicitly is refused", () => {
  // Static mirror of the computed covers() argument below for scripts/e2e-coverage-check.mjs; keep in sync.
  // @covers: /api/invoices, /api/clients, /api/invoices/templates, /api/invoices/export, /api/admin/audit-logs, /api/opt/experiments
  const resources = [
    { route: "/api/invoices", url: "/api/invoices" },
    { route: "/api/clients", url: "/api/clients" },
    { route: "/api/invoices/templates", url: "/api/invoices/templates" },
    { route: "/api/invoices/export", url: "/api/invoices/export?format=csv" },
    { route: "/api/admin/audit-logs", url: "/api/admin/audit-logs" },
    { route: "/api/opt/experiments", url: "/api/opt/experiments" },
  ];
  for (const { route, url } of resources) {
    test(`SEC-06 ${url} with x-organization-id or ?organizationId= of workspace A -> 403`, { annotation: covers(route) }, async () => {
      const viaHeader = await asB("GET", url, { organizationId: world.a.org });
      await expectStatus(viaHeader, 403, `GET ${url} x-organization-id`);
      const separator = url.includes("?") ? "&" : "?";
      const viaQuery = await asB("GET", `${url}${separator}organizationId=${world.a.org}`);
      await expectStatus(viaQuery, 403, `GET ${url}?organizationId=`);
      expectNoneOfA(`${await viaHeader.text()}${await viaQuery.text()}`, url);

      // Control: B naming its own workspace is fine.
      await expectStatus(await asB("GET", url, { organizationId: world.b.org }), 200, `GET ${url} own workspace`);
    });
  }

  test("SEC-06 a mutation into workspace A via x-organization-id -> 403 and nothing is created", { annotation: covers("/api/clients") }, async () => {
    const name = `SEC-06 injected ${Date.now()}`;
    const response = await asB("POST", "/api/clients", { organizationId: world.a.org, data: { name } });
    await expectStatus(response, 403, "POST /api/clients x-organization-id");
    const aClients = await (await asA("GET", "/api/clients")).text();
    expect(aClients).not.toContain(name);
  });
});
