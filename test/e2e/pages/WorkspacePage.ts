import { expect, type Locator, type Page, type Response } from "@playwright/test";

/**
 * /app/workspaces (app/app/workspaces/page.tsx) and /app/workspaces/<id>
 * (app/app/workspaces/[id]/page.tsx + WorkspaceInvitationPanel.tsx).
 *
 * List page: h1 "Your workspaces"; one <article> per membership with the
 * workspace name (h2), "Role: <ROLE>", an "Active" badge on the active one, a
 * "Manage workspace" link and, on inactive ones only, a "Switch workspace"
 * button (POST /api/workspaces/switch, then window.location.reload()). There
 * is no create/rename/delete UI.
 *
 * Detail page: h1 = workspace name, "Your role: <ROLE>", an h2 "Members" list
 * (name or email, email, role) and, only for roles with manage_members
 * (OWNER/ADMIN), the "Invite a teammate" panel: "Email" input, "Role" select
 * (Member/Viewer/Admin), "Create invite" button. A created invite shows a
 * message and the one-time link
 * `<origin>/app/workspace-invitations/accept?token=<raw token>` in a <p>; the
 * pending-invitations list shows "<ROLE> · Pending|Accepted|Revoked". A
 * non-member gets the Next.js 404 page.
 */
export class WorkspacePage {
  readonly listHeading: Locator;
  readonly membersHeading: Locator;
  readonly inviteHeading: Locator;
  readonly inviteEmail: Locator;
  readonly inviteRole: Locator;
  readonly inviteButton: Locator;
  /** The one-time accept link shown after "Create invite". */
  readonly inviteLink: Locator;

  constructor(readonly page: Page) {
    this.listHeading = page.getByRole("heading", { level: 1, name: "Your workspaces" });
    this.membersHeading = page.getByRole("heading", { level: 2, name: "Members" });
    this.inviteHeading = page.getByRole("heading", { name: "Invite a teammate" });
    this.inviteEmail = page.getByLabel("Email");
    this.inviteRole = page.getByLabel("Role");
    this.inviteButton = page.getByRole("button", { name: "Create invite" });
    this.inviteLink = page.locator("p").filter({ hasText: "/app/workspace-invitations/accept?token=" });
  }

  async gotoList(): Promise<void> {
    await this.page.goto("/app/workspaces");
    await expect(this.listHeading).toBeVisible();
  }

  async gotoDetail(organizationId: string, name: string): Promise<void> {
    await this.page.goto(`/app/workspaces/${organizationId}`);
    await expect(this.page.getByRole("heading", { level: 1, name })).toBeVisible();
  }

  /** The list-page card of one workspace, by its name. */
  card(name: string): Locator {
    return this.page.getByRole("article").filter({ has: this.page.getByRole("heading", { level: 2, name, exact: true }) });
  }

  activeBadge(name: string): Locator {
    return this.card(name).getByText("Active", { exact: true });
  }

  /** Click "Switch workspace" on a card; resolves with the switch response after the page reloads. */
  async switchTo(name: string): Promise<Response> {
    const switched = this.page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/workspaces/switch" && r.request().method() === "POST",
    );
    await this.card(name).getByRole("button", { name: "Switch workspace" }).click();
    const response = await switched;
    await expect(this.activeBadge(name)).toBeVisible();
    return response;
  }

  /** Detail page: the members list row for an email (scoped to the "Members" section). */
  member(email: string): Locator {
    return this.membersHeading.locator("xpath=ancestor::section[1]").getByRole("listitem").filter({ hasText: email });
  }

  /** Detail page: the invitation panel's row for an email ("<ROLE> · Pending|Accepted|Revoked"). */
  invitation(email: string): Locator {
    return this.inviteHeading.locator("xpath=ancestor::section[1]").getByRole("listitem").filter({ hasText: email });
  }

  /** Detail page: submit the invite form; resolves with the POST response. */
  async invite(email: string, role: "MEMBER" | "VIEWER" | "ADMIN" = "MEMBER"): Promise<Response> {
    await this.inviteEmail.fill(email);
    await this.inviteRole.selectOption(role);
    const created = this.page.waitForResponse(
      (r) => /\/api\/workspaces\/[^/]+\/invitations$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    );
    await this.inviteButton.click();
    return created;
  }
}
