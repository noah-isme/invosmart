// F9 Clients: CLI-01..04 (plan .plans/e2e-scenarios.md, "F9 Clients").
//
// Verified against the code:
// - /app/clients/new (ClientFormClient) POSTs /api/clients with csrfFetch and
//   routes to /app/clients; ?edit=<id> loads the same form as "Edit Client" and
//   PUTs /api/clients/<id>. On error it shows `error.message || error` from the
//   JSON body.
// - /app/clients lists the workspace's 10 newest clients as cards (h3 = name);
//   /app/clients/<id> shows the name (h1), contact info, "Edit" and "Delete"
//   (window.confirm, refused while the client has invoices) and calls
//   notFound() for a client outside the active workspace.
// - POST /api/clients first looks for a client with the same email in the
//   caller's workspace scope and answers 400 "A client with this email already
//   exists." (a plain string, not a field error); only then does
//   prisma.client.create run, where @@unique([organizationId, email]) and
//   @@unique([userId, email]) (prisma/schema.prisma) apply. A P2002 from
//   create answers 409 { code: "CLIENT_EMAIL_CONFLICT", field: "email" }
//   (CLI-03c). Clients are meant to be unique per WORKSPACE, so the per-user
//   constraint is itself the bug; dropping it is a schema change, and CLI-03b
//   documents the desired 201 as test.fail until that migration lands.
// - Every factory user has a membership, so the workspace scope is
//   { organizationId } in both WORKSPACE_AUTH_MODE values; nothing here is
//   mode-dependent.
// - Audit entries: CLIENT_CREATE / CLIENT_UPDATE / CLIENT_DELETE, entity "Client".
import { expect, test } from "../../fixtures";
import { ClientFormPage } from "../../pages/ClientFormPage";
import { uniqueEmail, type ClientRecord } from "../../support/api-factories";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test(
  "CLI-01 a member creates a client; it appears in /app/clients and on its detail page",
  { tag: "@smoke", annotation: covers("/app/clients/new", "/api/clients", "/app/clients", "/app/clients/[id]") },
  async ({ persona }) => {
    const { page } = await persona("member");
    const client = { name: `E2E CLI-01 ${tag()}`, company: "Kreatif Nusantara", email: uniqueEmail("cli01"), phone: "+62 811 0000 0001" };

    const form = new ClientFormPage(page);
    await form.gotoNew();
    await form.fill(client);
    const response = await form.submit();
    expect(response.status()).toBe(201);
    const { data: created } = (await response.json()) as { data: ClientRecord };

    await expect(page).toHaveURL(/\/app\/clients$/);
    const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: client.name }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText(client.email);

    await card.click();
    await expect(page).toHaveURL(new RegExp(`/app/clients/${created.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: client.name })).toBeVisible();
    await expect(page.getByText(client.email, { exact: true })).toBeVisible();
    await expect(page.getByText(client.phone, { exact: true })).toBeVisible();
  },
);

test(
  "CLI-02 editing and deleting a client is reflected in the list and the audit log",
  { annotation: covers("/app/clients/new", "/api/clients/[id]", "/app/clients/[id]", "/app/clients", "/api/admin/audit-logs") },
  async ({ isolatedUser }) => {
    const { page, api, factory } = isolatedUser;
    const client = await factory.createClient({ name: `E2E CLI-02 ${tag()}` });
    const renamed = `${client.name} renamed`;

    // Edit through the detail page's "Edit" link.
    await page.goto(`/app/clients/${client.id}`);
    await page.getByRole("link", { name: "Edit" }).click();
    const form = new ClientFormPage(page);
    await expect(form.editHeading).toBeVisible();
    await expect(form.field("name")).toHaveValue(client.name);
    await form.field("name").fill(renamed);
    expect((await form.submit()).status()).toBe(200);

    await expect(page).toHaveURL(/\/app\/clients$/);
    await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
    await expect(page.getByRole("heading", { name: client.name, exact: true })).toHaveCount(0);

    // Delete through the detail page (window.confirm).
    await page.getByRole("link").filter({ has: page.getByRole("heading", { name: renamed }) }).click();
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    const deleted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/clients/${client.id}` && r.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Delete" }).click();
    expect((await deleted).status()).toBe(200);
    await expect(page).toHaveURL(/\/app\/clients$/);
    await expect(page.getByRole("heading", { name: renamed })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No clients found" })).toBeVisible();
    expect((await api.get(`/api/clients/${client.id}`)).status()).toBe(404);

    await expect
      .poll(async () => {
        const { logs } = (await (await api.get("/api/admin/audit-logs?entity=Client")).json()) as {
          logs: Array<{ action: string; entityId: string; userId: string }>;
        };
        return logs.filter((log) => log.entityId === client.id && log.userId === isolatedUser.user.id).map((log) => log.action).sort();
      })
      .toEqual(["CLIENT_CREATE", "CLIENT_DELETE", "CLIENT_UPDATE"]);
  },
);

test.describe("CLI-03 duplicate client email", () => {
  test(
    "CLI-03 the same email twice in one workspace is rejected (400); another user's own workspace accepts it (201)",
    { annotation: covers("/api/clients") },
    async ({ newApiUser }) => {
      const a = await newApiUser("cli03-a");
      const b = await newApiUser("cli03-b");
      const workspace = a.user.workspace.organizationId;
      const { token } = await a.factory.inviteMember(workspace, { email: b.user.email, role: "MEMBER" });
      await b.factory.acceptInvitation(token);

      const email = uniqueEmail("cli03");
      await a.factory.createClient({ email });

      // B, a MEMBER of A's workspace W, uses the same email in W: the route's own
      // pre-check (scope { organizationId: W }) answers before
      // @@unique([organizationId, email]) is reached.
      const duplicate = await b.api.post("/api/clients", { organizationId: workspace, data: { name: `E2E CLI-03 ${tag()}`, email } });
      expect(duplicate.status()).toBe(400);
      expect(typeof (await duplicate.json()).error).toBe("string");

      // B in B's own workspace: different organisation and user, so 201.
      const own = await b.api.post("/api/clients", {
        organizationId: b.user.workspace.organizationId,
        data: { name: `E2E CLI-03 ${tag()}`, email },
      });
      expect(own.status()).toBe(201);
      expect((await own.json()).data).toMatchObject({ email, organizationId: b.user.workspace.organizationId });
    },
  );

  test(
    "CLI-03b the same user may reuse a client email in a second workspace (clients are unique per workspace)",
    {
      annotation: [
        ...covers("/api/clients"),
        {
          type: "issue",
          description:
            "prisma/schema.prisma Client @@unique([userId, email]) (map client_user_email) makes client emails unique per USER across workspaces; the intended rule is per workspace (@@unique([organizationId, email])). Needs a migration that drops client_user_email; until then the create answers 409 CLIENT_EMAIL_CONFLICT (CLI-03c).",
        },
      ],
    },
    async ({ newApiUser }) => {
      // Desired behaviour, blocked on the schema change: a second workspace of
      // the same user accepts the email (201).
      test.fail(true, "schema: Client @@unique([userId, email]) blocks per-workspace client emails (migration pending)");
      const a = await newApiUser("cli03b-a");
      const email = uniqueEmail("cli03b");
      await a.factory.createClient({ email });

      const second = await a.factory.createWorkspace();
      const response = await a.api.post("/api/clients", { organizationId: second.organizationId, data: { name: `E2E CLI-03b ${tag()}`, email } });
      test.info().annotations.push({ type: "observed-status", description: String(response.status()) });
      expect(response.status()).toBe(201);
      expect((await response.json()).data).toMatchObject({ email, organizationId: second.organizationId });
    },
  );

  test(
    "CLI-03c the same user reusing a client email in a second workspace never gets a 500 (409 CLIENT_EMAIL_CONFLICT until the schema changes)",
    { annotation: covers("/api/clients") },
    async ({ newApiUser }) => {
      const a = await newApiUser("cli03c-a");
      const email = uniqueEmail("cli03c");
      await a.factory.createClient({ email });

      const second = await a.factory.createWorkspace();
      const response = await a.api.post("/api/clients", { organizationId: second.organizationId, data: { name: `E2E CLI-03c ${tag()}`, email } });
      // 201 once the per-user constraint is dropped (then CLI-03b passes too).
      expect([201, 409]).toContain(response.status());
      if (response.status() === 409) {
        expect(await response.json()).toMatchObject({ code: "CLIENT_EMAIL_CONFLICT", field: "email", error: expect.any(String) });
      }
    },
  );
});

test(
  "CLI-04 a VIEWER cannot create a client (403); another user's client is 404",
  { annotation: covers("/app/clients/new", "/api/clients", "/app/clients/[id]", "/api/clients/[id]") },
  async ({ persona, isolatedUser, newApiUser }) => {
    const viewer = await persona("viewer");
    const form = new ClientFormPage(viewer.page);
    await form.gotoNew();
    await form.fill({ name: `E2E CLI-04 ${tag()}`, email: uniqueEmail("cli04") });
    const response = await form.submit();
    expect(response.status()).toBe(403);
    await expect(viewer.page.getByText("Workspace access denied")).toBeVisible();
    await expect(viewer.page).toHaveURL(/\/app\/clients\/new$/);

    const owner = await newApiUser("cli04-a");
    const client = await owner.factory.createClient();
    const { page, api } = isolatedUser;
    const detail = await page.goto(`/app/clients/${client.id}`);
    expect(detail?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: client.name })).toHaveCount(0);
    expect((await api.get(`/api/clients/${client.id}`)).status()).toBe(404);
    // Control: the owner still reads it.
    expect((await owner.api.get(`/api/clients/${client.id}`)).status()).toBe(200);
  },
);
