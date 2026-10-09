// F12 Workspaces: WS-01 (signup provisioning), WS-02 (second workspace and
// switch), WS-13 [E] and WS-14 [C] (plan .plans/e2e-scenarios.md, "F12
// Workspaces, RBAC, team operations").
//
// Verified against the code:
// - Registration provisions the personal workspace (User, Organization, OWNER
//   Membership and User.activeOrganizationId in one transaction) in both
//   WORKSPACE_AUTH_MODE values (lib/workspace-provisioning.ts
//   createUserWithPersonalWorkspace, docs/WORKSPACE_RBAC.md). WS-01 reads
//   GET /api/workspaces right after a raw register + credentials login (not
//   registerAndLogin, whose ensureActiveWorkspace would mask a missing
//   workspace). Under compat GET /api/workspaces would also provision lazily
//   for a membership-less user, so the enforce run is the strict check.
// - POST /api/workspaces makes the caller OWNER and switches to the new
//   workspace. There is no create/rename/delete UI and no
//   app/api/workspaces/[id]/route.ts, so rename/delete are waived (Step 24
//   coverage-waivers.json). /app/workspaces switches with "Switch workspace"
//   (POST /api/workspaces/switch, then a reload).
// - New invoices are scoped to the active workspace (workspaceData(context)).
// - A user with no membership of a workspace who asks for it explicitly
//   (x-organization-id) is denied with 403 "Workspace access denied"
//   (resolveWorkspaceContext returns null for a requested organization without
//   membership, in both modes); workspace-path routes answer 404.
// - WS-14: a membership-less user (the only state where compat and enforce
//   differ) cannot be built over HTTP: every user owns a personal workspace and
//   owners cannot be removed or demoted. The compat legacy-row fallback itself
//   is pinned in the integration layer (test/integration/db/workspaces.test.ts
//   "WS-14", it.fails vs docs). Over HTTP, compat is exercised with a member who
//   was removed from a workspace: their rows there stay in the workspace and
//   are not reachable through any userId fallback.
import { expect, test } from "../../fixtures";
import { WorkspacePage } from "../../pages/WorkspacePage";
import { listWorkspaces, registerUser, type InvoiceRecord } from "../../support/api-factories";
import { loginViaCredentialsApi } from "../../support/auth";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type InvoiceList = { data: Array<Pick<InvoiceRecord, "id" | "organizationId" | "client">> };

test(
  "WS-01 registration provisions exactly one active personal workspace with role OWNER",
  { tag: "@smoke", annotation: covers("/api/auth/register", "/api/workspaces", "/app/workspaces") },
  async ({ _newRequestContext, _newBrowserContext }) => {
    const request = await _newRequestContext({ cookies: [], origins: [] });
    const user = await registerUser(request, { name: `E2E WS-01 ${tag()}` });
    await loginViaCredentialsApi(request, user);

    const memberships = await listWorkspaces(request);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "OWNER", active: true });
    expect(memberships[0].organization.id).toBe(memberships[0].organizationId);

    // The list page shows the same single workspace as active.
    const page = await (await _newBrowserContext(await request.storageState())).newPage();
    const workspaces = new WorkspacePage(page);
    await workspaces.gotoList();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(workspaces.activeBadge(memberships[0].organization.name)).toBeVisible();
    await expect(workspaces.card(memberships[0].organization.name)).toContainText("Role: OWNER");
  },
);

test(
  "WS-02 an owner creates a second workspace, switches in the UI, and new invoices belong to the active one",
  { annotation: covers("/api/workspaces", "/api/workspaces/switch", "/app/workspaces", "/app/workspaces/[id]", "/api/invoices") },
  async ({ isolatedUser }) => {
    const { page, factory, api } = isolatedUser;
    const personal = isolatedUser.user.workspace;
    const second = await factory.createWorkspace({ name: `E2E WS-02 second ${tag()}` });
    expect(second.role).toBe("OWNER");

    // Creating a workspace makes it active.
    const after = await factory.listWorkspaces();
    expect(after.map((m) => m.organizationId).sort()).toEqual([personal.organizationId, second.organizationId].sort());
    expect(after.find((m) => m.active)?.organizationId).toBe(second.organizationId);

    const inSecond = await factory.createInvoice({ client: `E2E WS-02 second ${tag()}` });
    expect(inSecond.organizationId).toBe(second.organizationId);

    // Switch back to the personal workspace through the UI.
    const workspaces = new WorkspacePage(page);
    await workspaces.gotoList();
    await expect(workspaces.activeBadge(second.organization.name)).toBeVisible();
    await expect(workspaces.card(second.organization.name).getByRole("button", { name: "Switch workspace" })).toHaveCount(0);
    const switched = await workspaces.switchTo(personal.organization.name);
    expect(switched.status()).toBe(200);
    await expect(workspaces.activeBadge(second.organization.name)).toHaveCount(0);

    const inPersonal = await factory.createInvoice({ client: `E2E WS-02 personal ${tag()}` });
    expect(inPersonal.organizationId).toBe(personal.organizationId);

    // Lists follow the active workspace.
    const personalList = (await (await api.get("/api/invoices")).json()) as InvoiceList;
    expect(personalList.data.map((i) => i.id)).toContain(inPersonal.id);
    expect(personalList.data.map((i) => i.id)).not.toContain(inSecond.id);

    // And back to the second one; its detail page shows the OWNER role.
    await workspaces.switchTo(second.organization.name);
    const secondList = (await (await api.get("/api/invoices")).json()) as InvoiceList;
    expect(secondList.data.map((i) => i.id)).toEqual([inSecond.id]);
    await workspaces.card(second.organization.name).getByRole("link", { name: "Manage workspace" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/workspaces/${second.organizationId}$`));
    await expect(page.getByRole("heading", { level: 1, name: second.organization.name })).toBeVisible();
    await expect(page.getByText("Your role: OWNER")).toBeVisible();
    await expect(workspaces.member(isolatedUser.user.email)).toContainText("OWNER");
  },
);

test(
  "WS-13 enforce: a user without membership of a workspace is denied its resources (403)",
  {
    tag: "@mode:enforce",
    annotation: covers("/api/invoices", "/api/invoices/[id]", "/api/clients", "/api/invoices/export", "/api/workspaces/[id]/members", "/app/workspaces/[id]"),
  },
  async ({ newApiUser, _newBrowserContext }) => {
    const a = await newApiUser("ws13-owner");
    const outsider = await newApiUser("ws13-outsider");
    const org = a.user.workspace.organizationId;
    const invoice = await a.factory.createInvoice({ client: `E2E WS-13 ${tag()}` });

    // Selecting the workspace explicitly never grants access.
    for (const url of ["/api/invoices", `/api/invoices/${invoice.id}`, "/api/clients", "/api/invoices/export?format=csv"]) {
      expect((await outsider.api.get(url, { organizationId: org })).status(), `GET ${url}`).toBe(403);
    }
    expect((await outsider.api.get(`/api/invoices?organizationId=${org}`)).status()).toBe(403);
    expect(
      (await outsider.api.post("/api/invoices", { organizationId: org, data: { client: "x", dueAt: null, items: [{ name: "x", qty: 1, price: 1 }] } })).status(),
    ).toBe(403);
    // Workspace-path routes do not confirm the workspace exists.
    expect((await outsider.api.get(`/api/workspaces/${org}/members`)).status()).toBe(404);
    // Without a selector the outsider stays in its own workspace and never sees A's invoice.
    expect((await outsider.api.get(`/api/invoices/${invoice.id}`)).status()).toBe(404);
    expect((await (await a.api.get(`/api/invoices/${invoice.id}`)).json()).data.id).toBe(invoice.id);

    const page = await (await _newBrowserContext(await outsider.api.request.storageState())).newPage();
    const response = await page.goto(`/app/workspaces/${org}`);
    expect(response?.status()).toBe(404);
  },
);

test(
  "WS-14 compat: a member removed from a workspace no longer reaches its rows there; no userId fallback applies",
  {
    tag: "@mode:compat",
    annotation: [
      ...covers("/api/workspaces/[id]/members/[membershipId]", "/api/invoices", "/api/invoices/[id]", "/api/workspaces"),
      {
        type: "note",
        description:
          "The compat userId fallback for membership-less users cannot be reached over HTTP (every user keeps a personal workspace); test/integration/db/workspaces.test.ts WS-14 pins it (it.fails vs docs/WORKSPACE_RBAC.md Migration sequence step 5).",
      },
    ],
  },
  async ({ newApiUser }) => {
    const owner = await newApiUser("ws14-owner");
    const member = await newApiUser("ws14-member");
    const org = owner.user.workspace.organizationId;
    const { token } = await owner.factory.inviteMember(org, { email: member.user.email, role: "MEMBER" });
    const membership = await member.factory.acceptInvitation(token);
    await member.factory.switchWorkspace(org);

    // The member's own row in the shared workspace (userId = member).
    const own = await member.factory.createInvoice({ client: `E2E WS-14 ${tag()}` });
    expect(own).toMatchObject({ organizationId: org, userId: member.user.id });

    expect((await owner.api.delete(`/api/workspaces/${org}/members/${membership.id}`)).status()).toBe(200);

    // Explicitly selecting the old workspace: denied.
    expect((await member.api.get("/api/invoices", { organizationId: org })).status()).toBe(403);
    expect((await member.api.get(`/api/invoices/${own.id}`, { organizationId: org })).status()).toBe(403);

    // Default resolution: the stale activeOrganizationId has no membership, so
    // the resolver falls back to the member's first membership (the personal
    // workspace), not to userId ownership. The member's own invoice is gone
    // from view.
    expect((await member.api.get(`/api/invoices/${own.id}`)).status()).toBe(404);
    const list = (await (await member.api.get("/api/invoices")).json()) as InvoiceList;
    expect(list.data.map((i) => i.id)).not.toContain(own.id);
    expect(list.data.every((i) => i.organizationId === member.user.workspace.organizationId)).toBe(true);

    // /api/workspaces lists only the personal workspace. activeOrganizationId
    // still points at the old workspace, so no membership is flagged active
    // (observed behaviour; resolution above still lands on the personal one).
    const memberships = await member.factory.listWorkspaces();
    expect(memberships.map((m) => m.organizationId)).toEqual([member.user.workspace.organizationId]);
    expect(memberships[0].active).toBe(false);

    // The row itself is intact in the workspace.
    expect((await owner.api.get(`/api/invoices/${own.id}`)).status()).toBe(200);
  },
);
