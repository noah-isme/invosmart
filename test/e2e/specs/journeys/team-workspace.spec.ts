// JRN-02 (plan .plans/e2e-scenarios.md, "Cross-feature journeys"): a second
// workspace shared with a team, end to end across UI, session API and /api/v1.
//
// Verified against the code (details in specs/workspaces/* and specs/api-v1/*):
// - POST /api/workspaces makes the caller OWNER and switches to it; the owner
//   switches back to the personal workspace first so the later UI switch is
//   a real change.
// - /app/workspaces/<id> "Create invite" returns the raw token once; the
//   invitee opens /app/workspace-invitations/accept?token=... ("Welcome to the
//   team"). Accepting does not switch the invitee's active workspace.
// - New invoices land in the active workspace; /app/workspaces "Switch
//   workspace" posts /api/workspaces/switch and reloads.
// - VIEWER has read only: PUT/DELETE /api/invoices/<id> answer 403 in both
//   WORKSPACE_AUTH_MODE values (explicit x-organization-id membership).
// - /api/v1/invoices is scoped to the key's workspace (lib/api-v1/auth.ts).
import { expect, test } from "../../fixtures";
import { InvoiceFormPage } from "../../pages/InvoiceFormPage";
import { WorkspacePage } from "../../pages/WorkspacePage";
import type { InvoiceRecord } from "../../support/api-factories";
import { v1Client, type V1Success } from "../api-v1/v1";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Full PUT /api/invoices/[id] body (InvoiceUpdateSchema wants the totals echoed back). */
const invoiceUpdateBody = (invoice: InvoiceRecord, notes: string) => ({
  id: invoice.id,
  client: invoice.client,
  clientId: invoice.clientId,
  items: invoice.items,
  taxRate: invoice.subtotal > 0 ? invoice.tax / invoice.subtotal : 0,
  subtotal: invoice.subtotal,
  tax: invoice.tax,
  total: invoice.total,
  status: invoice.status,
  issuedAt: invoice.issuedAt,
  dueAt: invoice.dueAt,
  notes,
  currency: invoice.currency,
});

test(
  "JRN-02 owner creates workspace B, a member joins and invoices in B, the owner sees it after switching, a viewer cannot edit, and only B's API key lists it",
  {
    annotation: covers(
      "/api/workspaces",
      "/app/workspaces/[id]",
      "/api/workspaces/[id]/invitations",
      "/app/workspace-invitations/accept",
      "/api/workspace-invitations/[token]/accept",
      "/app/invoices/new",
      "/api/invoices",
      "/app/workspaces",
      "/api/workspaces/switch",
      "/app/dashboard",
      "/api/invoices/[id]",
      "/api/workspaces/[id]/api-keys",
      "/api/v1/invoices",
    ),
  },
  async ({ isolatedUser, newApiUser, guards, _newBrowserContext, _newRequestContext }) => {
    const owner = isolatedUser;
    const workspaceA = owner.user.workspace;
    const nameB = `JRN-02 Studio ${tag()}`;

    // 1. Workspace B (becomes active), then back to A.
    const workspaceB = await owner.factory.createWorkspace({ name: nameB });
    expect(workspaceB.role).toBe("OWNER");
    await owner.factory.switchWorkspace(workspaceA.organizationId);

    // 2. Invite a member to B from the workspace page.
    const member = await newApiUser("jrn02-member");
    const ownerWorkspaces = new WorkspacePage(owner.page);
    await ownerWorkspaces.gotoDetail(workspaceB.organizationId, nameB);
    const invited = await ownerWorkspaces.invite(member.user.email, "MEMBER");
    expect(invited.status()).toBe(201);
    const link = (await ownerWorkspaces.inviteLink.textContent())!.trim();
    expect(new URL(link).searchParams.get("token")).toBe(((await invited.json()) as { token: string }).token);

    // 3. The member accepts at the link.
    const memberPage = await (await _newBrowserContext(await member.api.request.storageState())).newPage();
    await memberPage.goto(new URL(link).pathname + new URL(link).search);
    await expect(memberPage.getByRole("heading", { level: 1, name: "Welcome to the team" })).toBeVisible();
    await owner.page.reload();
    await expect(ownerWorkspaces.member(member.user.email)).toContainText("MEMBER");

    // 4. The member switches to B and creates an invoice through the form.
    await member.factory.switchWorkspace(workspaceB.organizationId);
    const clientName = `JRN-02 Klien ${tag()}`;
    const form = new InvoiceFormPage(memberPage);
    await form.goto();
    await form.fill({ client: clientName, items: [{ name: "JRN-02 sesi", qty: 1, price: 400_000 }] });
    const posted = memberPage.waitForResponse((r) => new URL(r.url()).pathname === "/api/invoices" && r.request().method() === "POST");
    await form.saveDraft();
    const postedResponse = await posted;
    expect(postedResponse.status()).toBe(201);
    const { data: invoice } = (await postedResponse.json()) as { data: InvoiceRecord };
    expect(invoice.organizationId).toBe(workspaceB.organizationId);
    await expect(memberPage).toHaveURL(new RegExp(`/app/invoices/${invoice.id}$`));

    // 5. The owner does not see it in A, switches to B in the UI and does.
    const listA = (await (await owner.api.get("/api/invoices")).json()) as { data: InvoiceRecord[] };
    expect(listA.data.map((row) => row.id)).not.toContain(invoice.id);
    await ownerWorkspaces.gotoList();
    expect((await ownerWorkspaces.switchTo(nameB)).status()).toBe(200);
    await owner.page.goto("/app/dashboard");
    await expect(owner.page.getByRole("heading", { level: 1, name: "Dashboard invoice" })).toBeVisible();
    const row = owner.page.getByRole("row").filter({ has: owner.page.getByRole("link", { name: invoice.number }) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(clientName);

    // 6. A viewer of B can read the invoice but not change or delete it.
    const viewer = await newApiUser("jrn02-viewer");
    const { token: viewerToken } = await owner.factory.inviteMember(workspaceB.organizationId, { email: viewer.user.email, role: "VIEWER" });
    expect((await viewer.factory.acceptInvitation(viewerToken)).role).toBe("VIEWER");
    const inB = { organizationId: workspaceB.organizationId };
    expect((await viewer.api.get(`/api/invoices/${invoice.id}`, inB)).status()).toBe(200);
    const edit = await viewer.api.put(`/api/invoices/${invoice.id}`, { ...inB, data: invoiceUpdateBody(invoice, "viewer edit") });
    expect(edit.status()).toBe(403);
    expect((await viewer.api.delete(`/api/invoices/${invoice.id}`, inB)).status()).toBe(403);
    const unchanged = (await (await owner.api.get(`/api/invoices/${invoice.id}`)).json()) as { data: InvoiceRecord };
    expect(unchanged.data.notes).not.toBe("viewer edit");

    // 7. /api/v1: B's key lists the invoice, A's key does not.
    const { token: keyB } = await owner.factory.createApiKey(workspaceB.organizationId, { scopes: ["invoices:read"] });
    const { token: keyA } = await owner.factory.createApiKey(workspaceA.organizationId, { scopes: ["invoices:read"] });
    const bare = await _newRequestContext({ cookies: [], origins: [] });
    const listWith = async (token: string) => {
      const response = await v1Client(bare, token, guards).fetch("GET", "/api/v1/invoices?limit=100");
      expect(response.status()).toBe(200);
      return ((await response.json()) as V1Success<Array<{ id: string; organizationId: string }>>).data;
    };
    const viaB = await listWith(keyB);
    expect(viaB.map((entry) => entry.id)).toContain(invoice.id);
    expect(viaB.every((entry) => entry.organizationId === workspaceB.organizationId)).toBe(true);
    const viaA = await listWith(keyA);
    expect(viaA.map((entry) => entry.id)).not.toContain(invoice.id);
  },
);
