// F16 Audit logs: AUD-01, AUD-02, AUD-03 (plan .plans/e2e-scenarios.md, "F16 Audit logs").
//
// Verified against the code:
// - Invoice create/update/delete (app/api/invoices/route.ts POST,
//   app/api/invoices/[id]/route.ts PUT/DELETE) fire-and-forget
//   logAuditEvent({ tenantId: <workspace>, userId, action: INVOICE_CREATE |
//   INVOICE_UPDATE | INVOICE_DELETE, entity: "Invoice", entityId }); clients
//   log CLIENT_* with entity "Client". Writes are async (`void`), so reads use
//   expect.poll. Filters are exact, case-sensitive matches.
// - GET /api/admin/audit-logs is WORKSPACE-scoped, not platform-admin gated:
//   any member with read permission (canReadWorkspace, VIEWER included) gets
//   the rows whose tenantId is the caller's resolved workspace, newest first
//   (createdAt desc), filters action/entity/userId/fromDate/toDate,
//   limit (1..100, default 50)/skip, `total`; a tenantId other than the
//   caller's workspace -> 403. AUD-INT-01 (integration layer) covers the
//   signIn entry, whose tenantId is null and so never shows up here.
// - GET /api/admin/audit-log (singular) is `export { GET } from
//   "../audit-logs/route"`; /app/admin/audit-log (singular page) is
//   `export { default } from "../audit-logs/page"`. AUD-03 documents that they
//   do not diverge.
// - /app/admin/audit-logs (and the singular page) call
//   requirePlatformAdminPage(): platform admin only (non-admins -> /app). The
//   page is GLOBAL (every tenant) with GET-form filters Aksi/Entitas/User
//   ID/Tenant ID (inputs named action/entity/userId/tenantId), 25 rows per
//   page, createdAt desc, and "Menampilkan <n> dari <total> log audit.". The
//   specs scope it to the isolated workspace with the Tenant ID filter.
// - Every scenario writes into its own fresh user/workspace (newApiUser).
import { expect, test, type Api } from "../../fixtures";
import type { LoggedInUser } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const LOGS_API = "/api/admin/audit-logs";
const LOG_API_SINGULAR = "/api/admin/audit-log";
const LOGS_PAGE = "/app/admin/audit-logs";
const LOG_PAGE_SINGULAR = "/app/admin/audit-log";

type AuditRow = {
  id: string;
  tenantId: string | null;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  createdAt: string;
  user: { id: string; email: string; name: string | null } | null;
};
type AuditPage = { logs: AuditRow[]; total: number; limit: number; skip: number };

async function auditLogs(api: Api, query: Record<string, string> = {}, path = LOGS_API): Promise<AuditPage> {
  const response = await api.get(`${path}?${new URLSearchParams(query)}`);
  expect(response.status(), `GET ${path}?${new URLSearchParams(query)}`).toBe(200);
  return (await response.json()) as AuditPage;
}

/** Actions logged for one entity id (newest first), polled until `expected` are all present. */
async function waitForActions(api: Api, entity: string, entityId: string, expected: string[]): Promise<AuditRow[]> {
  let rows: AuditRow[] = [];
  await expect
    .poll(
      async () => {
        rows = (await auditLogs(api, { entity })).logs.filter((row) => row.entityId === entityId);
        return rows.map((row) => row.action).sort();
      },
      { message: `audit actions for ${entity} ${entityId}` },
    )
    .toEqual([...expected].sort());
  return rows;
}

/** Create, update (PUT to UNPAID) and delete one invoice, waiting for each audit row before the next step. */
async function invoiceLifecycle(api: Api, factory: { createInvoice: (input?: { status?: "UNPAID" }) => Promise<{ id: string }> }) {
  const invoice = await factory.createInvoice({ status: "UNPAID" }); // POST + PUT
  await waitForActions(api, "Invoice", invoice.id, ["INVOICE_CREATE", "INVOICE_UPDATE"]);
  expect((await api.delete(`/api/invoices/${encodeURIComponent(invoice.id)}`)).status()).toBe(204);
  const rows = await waitForActions(api, "Invoice", invoice.id, ["INVOICE_CREATE", "INVOICE_UPDATE", "INVOICE_DELETE"]);
  return { invoiceId: invoice.id, rows };
}

const isNewestFirst = (rows: Array<{ createdAt: string }>) =>
  rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].createdAt) >= Date.parse(row.createdAt));

function expectOwnRows(rows: AuditRow[], user: LoggedInUser) {
  for (const row of rows) {
    expect(row).toMatchObject({ tenantId: user.workspace.organizationId, userId: user.id, entity: "Invoice" });
    expect(row.user?.email).toBe(user.email);
  }
}

test.describe("audit logs", () => {
  test(
    "AUD-01 invoice create/update/delete produce audit entries with user and workspace, newest first in the API and on /app/admin/audit-logs",
    {
      annotation: [
        ...covers(LOGS_API, LOGS_PAGE, "/api/invoices", "/api/invoices/[id]"),
        {
          type: "note",
          description:
            "/app/admin/audit-logs is platform-admin only and global since the admin-access fix; the page part runs as the platformAdmin persona, scoped with the Tenant ID filter. The API is workspace-scoped and needs only read access.",
        },
      ],
    },
    async ({ newApiUser, persona }) => {
      const { user, api, factory } = await newApiUser("aud01");
      const { invoiceId, rows } = await invoiceLifecycle(api, factory);

      expect(rows.map((row) => row.action)).toEqual(["INVOICE_DELETE", "INVOICE_UPDATE", "INVOICE_CREATE"]);
      expectOwnRows(rows, user);

      const listing = await auditLogs(api);
      expect(isNewestFirst(listing.logs), "API listing is createdAt desc").toBe(true);
      expect(listing.logs.every((row) => row.tenantId === user.workspace.organizationId), "only this workspace's rows").toBe(true);

      // Page: platform admin, global listing narrowed to this workspace.
      const admin = await persona("platformAdmin");
      const { page } = admin;
      await page.goto(LOGS_PAGE);
      await expect(page.getByRole("heading", { name: "System Audit Logs" })).toBeVisible();
      await page.locator('input[name="tenantId"]').fill(user.workspace.organizationId);
      await page.locator('input[name="entity"]').fill("Invoice");
      await page.getByRole("button", { name: "Terapkan Filter" }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("tenantId") === user.workspace.organizationId);
      await expect(page.getByText("Menampilkan 3 dari 3 log audit.")).toBeVisible();

      const bodyRows = page.getByRole("row").filter({ hasText: invoiceId });
      await expect(bodyRows).toHaveCount(3);
      await expect(bodyRows.nth(0)).toContainText("INVOICE_DELETE");
      await expect(bodyRows.nth(1)).toContainText("INVOICE_UPDATE");
      await expect(bodyRows.nth(2)).toContainText("INVOICE_CREATE");
      for (let index = 0; index < 3; index += 1) {
        await expect(bodyRows.nth(index)).toContainText(user.email);
        await expect(bodyRows.nth(index)).toContainText("Invoice");
      }
    },
  );

  test(
    "AUD-02 action, entity (case sensitive), userId, date, tenant and limit filters narrow the list",
    { annotation: covers(LOGS_API, LOGS_PAGE, "/api/clients") },
    async ({ newApiUser, persona }) => {
      const { user, api, factory } = await newApiUser("aud02");
      const { invoiceId } = await invoiceLifecycle(api, factory);
      const client = await factory.createClient();
      await waitForActions(api, "Client", client.id, ["CLIENT_CREATE"]);

      const byAction = await auditLogs(api, { action: "INVOICE_UPDATE" });
      expect(byAction.logs.map((row) => [row.action, row.entityId])).toEqual([["INVOICE_UPDATE", invoiceId]]);
      expect(byAction.total).toBe(1);

      const invoices = await auditLogs(api, { entity: "Invoice" });
      expect(invoices.total).toBe(3);
      expect(invoices.logs.every((row) => row.entity === "Invoice")).toBe(true);

      const clients = await auditLogs(api, { entity: "Client" });
      expect(clients.logs.map((row) => [row.action, row.entityId])).toEqual([["CLIENT_CREATE", client.id]]);

      expect((await auditLogs(api, { entity: "invoice" })).total, "entity filter is case sensitive").toBe(0);

      expect((await auditLogs(api, { entity: "Invoice", userId: user.id })).total).toBe(3);
      expect((await auditLogs(api, { userId: "someone-else" })).total).toBe(0);

      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect((await auditLogs(api, { fromDate: future })).total).toBe(0);
      expect((await auditLogs(api, { entity: "Invoice", toDate: future })).total).toBe(3);

      const limited = await auditLogs(api, { entity: "Invoice", limit: "1" });
      expect(limited.logs).toHaveLength(1);
      expect(limited).toMatchObject({ total: 3, limit: 1, skip: 0 });
      expect(limited.logs[0].action).toBe("INVOICE_DELETE");
      const second = await auditLogs(api, { entity: "Invoice", limit: "1", skip: "1" });
      expect(second.logs[0].action).toBe("INVOICE_UPDATE");

      // Own workspace id is accepted, any other tenant is refused.
      expect((await auditLogs(api, { tenantId: user.workspace.organizationId, entity: "Invoice" })).total).toBe(3);
      const other = await newApiUser("aud02-other");
      expect((await api.get(`${LOGS_API}?tenantId=${encodeURIComponent(other.user.workspace.organizationId)}`)).status()).toBe(403);
      // ...and the other workspace's own listing does not contain these rows.
      expect((await auditLogs(other.api, { entity: "Invoice" })).logs.some((row) => row.entityId === invoiceId)).toBe(false);

      // Page filters (platform admin): tenant + action narrows to one row.
      const { page } = await persona("platformAdmin");
      await page.goto(`${LOGS_PAGE}?${new URLSearchParams({ tenantId: user.workspace.organizationId })}`);
      await expect(page.getByRole("row").filter({ hasText: invoiceId })).toHaveCount(3);
      await expect(page.getByRole("row").filter({ hasText: client.id })).toHaveCount(1);
      await page.locator('input[name="action"]').fill("CLIENT_CREATE");
      await page.getByRole("button", { name: "Terapkan Filter" }).click();
      await expect(page.getByText("Menampilkan 1 dari 1 log audit.")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: client.id })).toContainText("Client");
    },
  );

  test(
    "AUD-03 the singular /api/admin/audit-log and /app/admin/audit-log return the same entries as the plural routes",
    {
      annotation: [
        ...covers(LOG_API_SINGULAR, LOG_PAGE_SINGULAR, LOGS_API, LOGS_PAGE),
        {
          type: "note",
          description:
            "No divergence: app/api/admin/audit-log/route.ts re-exports the plural GET and app/app/admin/audit-log/page.tsx re-exports the plural page. The divergence that does exist is between API and page: the API is workspace-scoped for any member with read access (VIEWER included), the pages are platform-admin only and list every tenant.",
        },
      ],
    },
    async ({ newApiUser, persona, page: ownerPage }) => {
      const { user, api, factory } = await newApiUser("aud03");
      const { invoiceId } = await invoiceLifecycle(api, factory);

      const queries: Array<Record<string, string>> = [{}, { entity: "Invoice" }, { action: "INVOICE_CREATE" }, { entity: "Invoice", limit: "2", skip: "1" }];
      for (const query of queries) {
        const plural = await auditLogs(api, query, LOGS_API);
        const singular = await auditLogs(api, query, LOG_API_SINGULAR);
        expect(singular, `singular == plural for ${JSON.stringify(query)}`).toEqual(plural);
      }

      // Same rows on both pages for the same filter (platform admin).
      const admin = await persona("platformAdmin");
      const query = `?${new URLSearchParams({ tenantId: user.workspace.organizationId, entity: "Invoice" })}`;
      const rowsOn = async (path: string) => {
        await admin.page.goto(`${path}${query}`);
        await expect(admin.page.getByText("Menampilkan 3 dari 3 log audit.")).toBeVisible();
        return admin.page.getByRole("row").filter({ hasText: invoiceId }).allInnerTexts();
      };
      const pluralRows = await rowsOn(LOGS_PAGE);
      const singularRows = await rowsOn(LOG_PAGE_SINGULAR);
      expect(pluralRows).toHaveLength(3);
      expect(singularRows).toEqual(pluralRows);

      // Non-admins: both pages redirect; the API stays workspace-scoped (VIEWER reads its workspace).
      for (const path of [LOGS_PAGE, LOG_PAGE_SINGULAR]) {
        await ownerPage.goto(path);
        await expect(ownerPage, `${path} redirects a workspace OWNER`).toHaveURL((url) => url.pathname === "/app");
      }
      const viewer = await persona("viewer");
      const viewerWorkspace = (await viewer.factory.listWorkspaces()).find((membership) => membership.active);
      const viewerRows = await auditLogs(viewer.api, {}, LOG_API_SINGULAR);
      expect(viewerRows.logs.every((row) => row.tenantId === viewerWorkspace!.organizationId)).toBe(true);
      expect(viewerRows.logs.some((row) => row.entityId === invoiceId)).toBe(false);
    },
  );
});
