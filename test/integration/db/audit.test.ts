// AUD-INT-01: the next-auth signIn event writes an AUTH_LOGIN_SUCCESS audit
// entry tenanted to the user's active workspace, so the workspace-scoped
// listing shows it; a user without an active workspace still gets an
// (untenanted) entry. AUD-INT-02: registration writes AUTH_REGISTER tenanted
// to the personal workspace it provisions.
// @covers: /api/admin/audit-logs, /api/auth/register (route handlers called in-process; scripts/e2e-coverage-check.mjs)
import { describe, expect, it, vi } from "vitest";

import { GET as listAuditLogs } from "@/app/api/admin/audit-logs/route";
import { POST as register } from "@/app/api/auth/register/route";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { authOptions } from "@/server/auth";

import { createUser, createUserWithWorkspace, db, request, signInAs, uid, waitFor } from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

type SignInEvent = NonNullable<NonNullable<typeof authOptions.events>["signIn"]>;
type AuditListing = { logs: { id: string; tenantId: string | null }[] };

const fireSignIn = (user: { id: string; email: string; name: string | null }) =>
  (authOptions.events?.signIn as SignInEvent)({
    user: { id: user.id, email: user.email, name: user.name },
    account: { provider: "credentials", type: "credentials", providerAccountId: user.id },
    isNewUser: false,
  } as Parameters<SignInEvent>[0]);

describe("AUD-INT-01 signIn audit entry", () => {
  it("is tenanted to the user's active workspace and listed by the workspace-scoped API", async () => {
    const { user, organization } = await createUserWithWorkspace();

    // The event next-auth fires after a successful credentials login.
    await fireSignIn(user);

    // logAuditEvent is fire-and-forget inside the event handler.
    const entry = await waitFor(() =>
      db.auditLog.findFirst({ where: { userId: user.id, action: "AUTH_LOGIN_SUCCESS" } }),
    );
    expect(entry).toMatchObject({ tenantId: organization.id, entity: "Auth", userId: user.id });
    expect(entry.details).toMatchObject({ provider: "credentials", email: user.email });

    // Control: another entry scoped to the workspace is listed alongside it.
    const control = await logAuditEvent({
      tenantId: organization.id,
      userId: user.id,
      action: "INT_AUDIT_CONTROL",
      entity: "Integration",
    });
    expect(control).not.toBeNull();

    signInAs(user);
    for (const query of ["", `?userId=${user.id}`, "?action=AUTH_LOGIN_SUCCESS", `?tenantId=${organization.id}`]) {
      const res = await listAuditLogs(request(`/api/admin/audit-logs${query}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as AuditListing;
      const ids = body.logs.map((log) => log.id);
      expect(ids).toContain(entry.id);
      expect(body.logs.every((log) => log.tenantId === organization.id)).toBe(true);
      if (query !== "?action=AUTH_LOGIN_SUCCESS") {
        expect(ids).toContain(control!.id);
      }
    }
  });

  it("still writes an untenanted entry for a user without an active workspace", async () => {
    const user = await createUser();
    await fireSignIn(user);
    const entry = await waitFor(() =>
      db.auditLog.findFirst({ where: { userId: user.id, action: "AUTH_LOGIN_SUCCESS" } }),
    );
    expect(entry).toMatchObject({ tenantId: null, entity: "Auth", userId: user.id });
  });

  it("does not tenant the entry to a workspace the user was removed from", async () => {
    const { organization } = await createUserWithWorkspace();
    const removed = await createUser();
    await db.membership.create({ data: { organizationId: organization.id, userId: removed.id, role: "MEMBER" } });
    await db.user.update({ where: { id: removed.id }, data: { activeOrganizationId: organization.id } });
    // Removing a member deletes the Membership but leaves activeOrganizationId behind.
    await db.membership.delete({ where: { organizationId_userId: { organizationId: organization.id, userId: removed.id } } });

    await fireSignIn(removed);
    const entry = await waitFor(() =>
      db.auditLog.findFirst({ where: { userId: removed.id, action: "AUTH_LOGIN_SUCCESS" } }),
    );
    expect(entry.tenantId).toBeNull();
    expect(await db.auditLog.count({ where: { tenantId: organization.id, userId: removed.id } })).toBe(0);
  });
});

describe("AUD-INT-02 registration audit entry", () => {
  it("is tenanted to the provisioned personal workspace", async () => {
    const email = `int+register-${uid()}@invosmart.test`;
    const res = await register(
      request("/api/auth/register", { method: "POST", body: { name: "Int Register", email, password: "Sup3r-secret-pass!" } }),
    );
    expect(res.status).toBe(201);

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.activeOrganizationId).toBeTruthy();
    const entry = await waitFor(() => db.auditLog.findFirst({ where: { userId: user.id, action: "AUTH_REGISTER" } }));
    expect(entry).toMatchObject({ tenantId: user.activeOrganizationId, entity: "User", entityId: user.id });

    signInAs({ id: user.id, email: user.email, name: user.name });
    const listing = (await (await listAuditLogs(request("/api/admin/audit-logs?action=AUTH_REGISTER"))).json()) as AuditListing;
    expect(listing.logs.map((log) => log.id)).toContain(entry.id);
  });
});
