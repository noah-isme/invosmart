// AUD-INT-01: the next-auth signIn event writes an AUTH_LOGIN_SUCCESS audit
// entry with a null tenantId, so the workspace-scoped listing never shows it.
import { describe, expect, it, vi } from "vitest";

import { GET as listAuditLogs } from "@/app/api/admin/audit-logs/route";
import { logAuditEvent } from "@/lib/audit/auditLogger";
import { authOptions } from "@/server/auth";

import { createUserWithWorkspace, db, request, signInAs, waitFor } from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

type SignInEvent = NonNullable<NonNullable<typeof authOptions.events>["signIn"]>;

describe("AUD-INT-01 signIn audit entry", () => {
  it("is persisted with a null tenantId and is absent from the workspace-scoped listing", async () => {
    const { user, organization } = await createUserWithWorkspace();

    // The event next-auth fires after a successful credentials login.
    const signIn = authOptions.events?.signIn as SignInEvent;
    await signIn({
      user: { id: user.id, email: user.email, name: user.name },
      account: { provider: "credentials", type: "credentials", providerAccountId: user.id },
      isNewUser: false,
    } as Parameters<SignInEvent>[0]);

    // logAuditEvent is fire-and-forget inside the event handler.
    const entry = await waitFor(() =>
      db.auditLog.findFirst({ where: { userId: user.id, action: "AUTH_LOGIN_SUCCESS" } }),
    );
    expect(entry).toMatchObject({ tenantId: null, entity: "Auth", userId: user.id });
    expect(entry.details).toMatchObject({ provider: "credentials", email: user.email });

    // Positive control: an entry scoped to the workspace is listed.
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
      const body = (await res.json()) as { logs: { id: string; tenantId: string | null }[] };
      const ids = body.logs.map((log) => log.id);
      expect(ids).not.toContain(entry.id);
      expect(body.logs.every((log) => log.tenantId === organization.id)).toBe(true);
      if (query === "" || query.startsWith("?userId") || query.startsWith("?tenantId")) {
        expect(ids).toContain(control!.id);
      }
    }
  });
});
