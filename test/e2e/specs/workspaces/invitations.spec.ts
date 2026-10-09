// F12 Workspaces: WS-03 invitation flow (UI), WS-04 one-time tokens, WS-05
// role-change rules (plan .plans/e2e-scenarios.md, "F12 Workspaces, RBAC,
// team operations"). WS-INT-01 (expiry, digest storage) is in the integration
// layer.
//
// Verified against the code:
// - POST /api/workspaces/[id]/invitations (manage_members; an ADMIN may not
//   invite an ADMIN -> 403) returns the redacted record plus the raw `token`
//   once; GET lists id/email/role/expiresAt/acceptedAt/revokedAt/createdAt only.
//   The panel on /app/workspaces/[id] shows the one-time accept link until the
//   page is reloaded.
// - /app/workspace-invitations/accept?token=... POSTs
//   /api/workspace-invitations/<token>/accept on load: success -> h1 "Welcome to
//   the team"; failure -> h1 "Invitation status" and the route's error text.
// - Accept: unknown token -> 404; signed-in email differs from the invitation
//   -> 403; already claimed -> 409 (the claim is a compare-and-set on
//   acceptedAt; verifyInvitationToken reads usedAt/consumedAt, not acceptedAt,
//   so the CAS is what rejects the reuse).
// - PATCH /api/workspaces/[id]/members/[membershipId] accepts ADMIN|MEMBER|VIEWER
//   only; any OWNER target -> 403 ("owner-only management"), and an ADMIN
//   granting ADMIN -> 403. DELETE of an OWNER -> 409. There is no way to add a
//   second OWNER over the API, so "the last owner" is every owner.
import { expect, test } from "../../fixtures";
import { WorkspacePage } from "../../pages/WorkspacePage";

const covers = (...routes: string[]) => routes.map((description) => ({ type: "covers", description }));

type Member = { id: string; role: string; user: { email: string } };

test(
  "WS-03 an owner invites a MEMBER in the UI; the invitee accepts at the link, sees \"Welcome to the team\" and is listed",
  {
    annotation: covers(
      "/app/workspaces/[id]",
      "/api/workspaces/[id]/invitations",
      "/app/workspace-invitations/accept",
      "/api/workspace-invitations/[token]/accept",
      "/api/workspaces/[id]/members",
    ),
  },
  async ({ isolatedUser, newApiUser, _newBrowserContext }) => {
    const { page, api } = isolatedUser;
    const org = isolatedUser.user.workspace;
    const invitee = await newApiUser("ws03-invitee");

    const workspace = new WorkspacePage(page);
    await workspace.gotoDetail(org.organizationId, org.organization.name);
    await expect(page.getByText("Member management enabled")).toBeVisible();
    const created = await workspace.invite(invitee.user.email, "MEMBER");
    expect(created.status()).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect(token.length).toBeGreaterThan(20);

    // The raw token is shown once, as the accept link.
    await expect(workspace.inviteLink).toBeVisible();
    const link = (await workspace.inviteLink.textContent())!.trim();
    expect(new URL(link).pathname).toBe("/app/workspace-invitations/accept");
    expect(new URL(link).searchParams.get("token")).toBe(token);
    await expect(workspace.invitation(invitee.user.email)).toContainText("MEMBER · Pending");

    // Not after a reload, and never through the list API.
    await page.reload();
    await expect(workspace.inviteHeading).toBeVisible();
    await expect(workspace.inviteLink).toHaveCount(0);
    const listed = await api.get(`/api/workspaces/${org.organizationId}/invitations`);
    expect(listed.status()).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain(token);
    const invitation = ((JSON.parse(listedText) as { data: Array<Record<string, unknown>> }).data).find((i) => i.email === invitee.user.email)!;
    expect(Object.keys(invitation).sort()).toEqual(["acceptedAt", "createdAt", "email", "expiresAt", "id", "revokedAt", "role"]);

    // The invitee, signed in in their own browser context, opens the link.
    const inviteePage = await (await _newBrowserContext(await invitee.api.request.storageState())).newPage();
    const accepted = inviteePage.waitForResponse((r) => r.url().includes("/api/workspace-invitations/") && r.request().method() === "POST");
    await inviteePage.goto(new URL(link).pathname + new URL(link).search);
    expect((await accepted).status()).toBe(200);
    await expect(inviteePage.getByRole("heading", { level: 1, name: "Welcome to the team" })).toBeVisible();
    await expect(inviteePage.getByText("You are now a member of the workspace.")).toBeVisible();

    // The invitee now has the workspace (accepting does not switch to it).
    const inviteeMemberships = await invitee.factory.listWorkspaces();
    expect(inviteeMemberships.find((m) => m.organizationId === org.organizationId)).toMatchObject({ role: "MEMBER", active: false });

    // The owner sees the new member and the accepted invitation.
    const members = (await (await api.get(`/api/workspaces/${org.organizationId}/members`)).json()) as { data: Member[] };
    expect(members.data.find((m) => m.user.email === invitee.user.email)?.role).toBe("MEMBER");
    await page.reload();
    await expect(workspace.member(invitee.user.email)).toContainText("MEMBER");
    await expect(workspace.invitation(invitee.user.email)).toContainText("MEMBER · Accepted");
  },
);

test(
  "WS-04 an accepted invitation token cannot be reused (409, also in the UI); a foreign account or unknown token is rejected",
  { annotation: covers("/api/workspace-invitations/[token]/accept", "/app/workspace-invitations/accept") },
  async ({ newApiUser, _newBrowserContext }) => {
    const owner = await newApiUser("ws04-owner");
    const invitee = await newApiUser("ws04-invitee");
    const stranger = await newApiUser("ws04-stranger");
    const org = owner.user.workspace.organizationId;

    const { token } = await owner.factory.inviteMember(org, { email: invitee.user.email, role: "VIEWER" });

    // Another signed-in account cannot claim it (403) and does not consume it.
    expect((await stranger.api.post(`/api/workspace-invitations/${encodeURIComponent(token)}/accept`)).status()).toBe(403);

    expect((await invitee.factory.acceptInvitation(token)).role).toBe("VIEWER");
    const again = await invitee.api.post(`/api/workspace-invitations/${encodeURIComponent(token)}/accept`);
    expect(again.status()).toBe(409);

    // The membership is unchanged and not duplicated.
    const members = (await (await owner.api.get(`/api/workspaces/${org}/members`)).json()) as { data: Member[] };
    expect(members.data.filter((m) => m.user.email === invitee.user.email).map((m) => m.role)).toEqual(["VIEWER"]);

    // The accept page shows the failure instead of the welcome.
    const page = await (await _newBrowserContext(await invitee.api.request.storageState())).newPage();
    await page.goto(`/app/workspace-invitations/accept?token=${encodeURIComponent(token)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Invitation status" })).toBeVisible();
    await expect(page.getByText(/already been claimed/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome to the team" })).toHaveCount(0);

    // An unknown token.
    expect((await invitee.api.post(`/api/workspace-invitations/${"0".repeat(43)}/accept`)).status()).toBe(404);
  },
);

test(
  "WS-05 role changes: an ADMIN cannot change an OWNER or grant ADMIN; the owner cannot be removed or demoted",
  {
    annotation: [
      ...covers("/api/workspaces/[id]/members/[membershipId]", "/api/workspaces/[id]/invitations", "/api/workspaces/[id]/members"),
      {
        type: "doc-mismatch",
        description:
          "docs/WORKSPACE_RBAC.md: \"The last owner cannot be removed or demoted\". The code protects every OWNER (PATCH -> 403, DELETE -> 409) and offers no way to add a second OWNER, so ownership cannot be transferred (docs list \"ownership transfer\" for OWNER).",
      },
    ],
  },
  async ({ newApiUser }) => {
    const owner = await newApiUser("ws05-owner");
    const admin = await newApiUser("ws05-admin");
    const member = await newApiUser("ws05-member");
    const org = owner.user.workspace.organizationId;
    await admin.factory.acceptInvitation((await owner.factory.inviteMember(org, { email: admin.user.email, role: "ADMIN" })).token);
    await member.factory.acceptInvitation((await owner.factory.inviteMember(org, { email: member.user.email, role: "MEMBER" })).token);

    const members = async () => ((await (await owner.api.get(`/api/workspaces/${org}/members`)).json()) as { data: Member[] }).data;
    const idOf = async (email: string) => (await members()).find((m) => m.user.email === email)!.id;
    const ownerId = await idOf(owner.user.email);
    const memberId = await idOf(member.user.email);
    const path = (id: string) => `/api/workspaces/${org}/members/${id}`;

    // ADMIN vs OWNER.
    expect((await admin.api.patch(path(ownerId), { data: { role: "MEMBER" } })).status()).toBe(403);
    expect((await admin.api.delete(path(ownerId))).status()).toBe(409);
    // ADMIN cannot grant ADMIN (role change or invitation); can demote/promote below it.
    expect((await admin.api.patch(path(memberId), { data: { role: "ADMIN" } })).status()).toBe(403);
    expect((await admin.api.post(`/api/workspaces/${org}/invitations`, { data: { email: `ws05-${Date.now()}@invosmart.test`, role: "ADMIN" } })).status()).toBe(403);
    expect((await admin.api.patch(path(memberId), { data: { role: "VIEWER" } })).status()).toBe(200);

    // The (last) OWNER cannot demote or remove itself.
    expect((await owner.api.patch(path(ownerId), { data: { role: "ADMIN" } })).status()).toBe(403);
    expect((await owner.api.delete(path(ownerId))).status()).toBe(409);
    // OWNER is not an assignable role.
    expect((await owner.api.patch(path(memberId), { data: { role: "OWNER" } })).status()).toBe(400);
    // The OWNER may grant ADMIN.
    expect((await owner.api.patch(path(memberId), { data: { role: "ADMIN" } })).status()).toBe(200);

    expect(Object.fromEntries((await members()).map((m) => [m.user.email, m.role]))).toEqual({
      [owner.user.email]: "OWNER",
      [admin.user.email]: "ADMIN",
      [member.user.email]: "ADMIN",
    });
  },
);
