// WS-INT-01 (invitation digest + expiry), WS-INT-02 (Slack endpoint
// ciphertext + missing key) and the WS-14 compat legacy-row fallback.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as acceptInvitation } from "@/app/api/workspace-invitations/[token]/accept/route";
import { POST as createInvitation } from "@/app/api/workspaces/[id]/invitations/route";
import {
  GET as listEndpoints,
  POST as saveEndpoint,
} from "@/app/api/workspaces/[id]/notifications/route";
import { GET as listInvoices } from "@/app/api/invoices/route";
import { decryptWorkspaceSecret } from "@/lib/team/secrets";

import {
  DAY_MS,
  createInvoice,
  createUser,
  createUserWithWorkspace,
  db,
  request,
  routeParams,
  signInAs,
  waitFor,
} from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function invite(ownerWorkspace: Awaited<ReturnType<typeof createUserWithWorkspace>>, email: string) {
  signInAs(ownerWorkspace.user);
  const res = await createInvitation(
    request(`/api/workspaces/${ownerWorkspace.organization.id}/invitations`, { method: "POST", body: { email, role: "MEMBER" } }),
    routeParams({ id: ownerWorkspace.organization.id }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string; data: { id: string } };
  // The create audit entry is fire-and-forget; let it land before moving on.
  await waitFor(() => db.auditLog.findFirst({ where: { entityId: body.data.id, action: "WORKSPACE_INVITATION_CREATE" } }));
  return body;
}

const accept = (token: string) =>
  acceptInvitation(request(`/api/workspace-invitations/${token}/accept`, { method: "POST" }), routeParams({ token }));

describe("WS-INT-01 invitation tokens", () => {
  it("stores only a SHA-256 digest of the token and expires it after seven days", async () => {
    const owner = await createUserWithWorkspace();
    const invitee = await createUser();
    const { token, data } = await invite(owner, invitee.email);

    const row = await db.workspaceInvitation.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThanOrEqual(7 * DAY_MS - 5_000);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(7 * DAY_MS + 5_000);

    // Backdate the invitation by 8 days: it expired a day ago.
    const createdAt = new Date(Date.now() - 8 * DAY_MS);
    await db.workspaceInvitation.update({
      where: { id: row.id },
      data: { createdAt, expiresAt: new Date(createdAt.getTime() + 7 * DAY_MS) },
    });

    signInAs(invitee);
    const res = await accept(token);
    expect(res.status).toBe(410);
    const after = await db.workspaceInvitation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.acceptedAt).toBeNull();
    expect(
      await db.membership.findUnique({
        where: { organizationId_userId: { organizationId: owner.organization.id, userId: invitee.id } },
      }),
    ).toBeNull();
  });

  it("positive control: a fresh token is accepted once, then rejected", async () => {
    const owner = await createUserWithWorkspace();
    const invitee = await createUser();
    const { token } = await invite(owner, invitee.email);

    signInAs(invitee);
    const first = await accept(token);
    expect(first.status).toBe(200);
    const membership = await db.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: owner.organization.id, userId: invitee.id } },
    });
    expect(membership.role).toBe("MEMBER");
    await waitFor(() => db.auditLog.findFirst({ where: { userId: invitee.id, action: "WORKSPACE_INVITATION_ACCEPT" } }));

    const second = await accept(token);
    expect(second.status).toBe(409);
  });
});

describe("WS-INT-02 Slack endpoint secrets", () => {
  const webhookUrl = "https://hooks.slack.com/services/T0INT0000/B0INT0000/integrationSecretToken";
  const original = process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY;
  afterEach(() => {
    process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY = original;
  });

  const save = (organizationId: string) =>
    saveEndpoint(
      request(`/api/workspaces/${organizationId}/notifications`, { method: "POST", body: { type: "SLACK", webhookUrl } }),
      routeParams({ id: organizationId }),
    );

  it("persists ciphertext, never the URL, and never returns it", async () => {
    const { user, organization } = await createUserWithWorkspace();
    signInAs(user);

    const res = await save(organization.id);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("hooks.slack.com");

    const row = await db.workspaceNotificationEndpoint.findUniqueOrThrow({
      where: { organizationId_type: { organizationId: organization.id, type: "SLACK" } },
    });
    expect(row.secretCiphertext).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(row.secretCiphertext).not.toContain("hooks.slack.com");
    expect(row.secretCiphertext).not.toContain("integrationSecretToken");
    expect(decryptWorkspaceSecret(row.secretCiphertext)).toBe(webhookUrl);

    const list = await listEndpoints(request(`/api/workspaces/${organization.id}/notifications`), routeParams({ id: organization.id }));
    expect(list.status).toBe(200);
    const listed = await list.json();
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("hooks.slack.com");
    expect(listed.data[0]).not.toHaveProperty("secretCiphertext");
  });

  it("refuses to save when WORKSPACE_NOTIFICATION_ENCRYPTION_KEY is absent", async () => {
    const { user, organization } = await createUserWithWorkspace();
    signInAs(user);
    delete process.env.WORKSPACE_NOTIFICATION_ENCRYPTION_KEY;

    const res = await save(organization.id);
    expect(res.status).toBe(503);
    expect(await db.workspaceNotificationEndpoint.count({ where: { organizationId: organization.id } })).toBe(0);
  });
});

describe("WS-14 compat legacy-row fallback", () => {
  const original = process.env.WORKSPACE_AUTH_MODE;
  afterEach(() => {
    process.env.WORKSPACE_AUTH_MODE = original;
  });

  async function legacyUserWithoutMembership() {
    const { user, organization } = await createUserWithWorkspace();
    // A pre-workspace row: organizationId is null, only userId owns it.
    const legacy = await createInvoice({ userId: user.id, organizationId: null, status: "SENT" });
    // The membership is removed (and the active-workspace hint cleared).
    await db.membership.deleteMany({ where: { userId: user.id } });
    await db.user.update({ where: { id: user.id }, data: { activeOrganizationId: null } });
    return { user, organization, legacy };
  }

  const list = () => listInvoices(request("/api/invoices"));

  it("enforce: a user without membership is denied", async () => {
    process.env.WORKSPACE_AUTH_MODE = "enforce";
    const { user } = await legacyUserWithoutMembership();
    signInAs(user);
    expect((await list()).status).toBe(403);
  });

  // docs/WORKSPACE_RBAC.md ("Migration sequence" step 5) documents that compat
  // retains the legacy `userId` fallback. With a real database the resolver
  // never reaches it for a user without membership: lib/workspaces.ts
  // resolveWorkspaceContext provisions a new personal workspace instead
  // (provisionPersonalWorkspace) and scopes the query by that new
  // organizationId, so null-organization rows stay invisible. Recorded as a
  // doc/product mismatch with docs/WORKSPACE_RBAC.md (compat provisions a
  // workspace instead of the userId fallback); kept as an expected failure,
  // consistent with EXP-05/06. The passing pin test below asserts the actual
  // behaviour.
  it.fails("compat: the user's legacy null-organization rows are listed via the userId fallback", async () => {
    process.env.WORKSPACE_AUTH_MODE = "compat";
    const { user, legacy } = await legacyUserWithoutMembership();
    signInAs(user);
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data as { id: string }[]).map((i) => i.id);
    expect(ids).toContain(legacy.id);
  });

  it("compat: what actually happens - a personal workspace is provisioned and legacy rows are not listed", async () => {
    process.env.WORKSPACE_AUTH_MODE = "compat";
    const { user, organization, legacy } = await legacyUserWithoutMembership();
    signInAs(user);
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data as { id: string }[]).map((i) => i.id);
    expect(ids).not.toContain(legacy.id);

    const memberships = await db.membership.findMany({ where: { userId: user.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe("OWNER");
    expect(memberships[0].organizationId).not.toBe(organization.id);
    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.activeOrganizationId).toBe(memberships[0].organizationId);
    // Another user's legacy rows are never exposed either way.
    expect((await db.invoice.findUniqueOrThrow({ where: { id: legacy.id } })).organizationId).toBeNull();
  });
});
