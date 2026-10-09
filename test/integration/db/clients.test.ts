// CLI-INT-01: POST /api/clients maps the @@unique([userId, email]) violation
// (the same user reusing a client email in a second workspace) to a 409 with
// an error code instead of an unhandled 500. The desired per-workspace
// behaviour (201) needs a schema change; CLI-03b in the e2e suite keeps it
// documented as test.fail.
// @covers: /api/clients (route handlers called in-process; scripts/e2e-coverage-check.mjs)
import { describe, expect, it, vi } from "vitest";

import { POST as createClient } from "@/app/api/clients/route";

import { createUserWithWorkspace, createWorkspace, db, request, signInAs, uid } from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const post = (organizationId: string, body: Record<string, unknown>) =>
  createClient(request(`/api/clients?organizationId=${organizationId}`, { method: "POST", body }));

describe("CLI-INT-01 client email uniqueness", () => {
  it("answers 409 CLIENT_EMAIL_CONFLICT when the same user reuses a client email in a second workspace", async () => {
    const { user, organization } = await createUserWithWorkspace();
    const second = await createWorkspace(user);
    signInAs(user);
    const email = `int+client-${uid()}@invosmart.test`;

    const first = await post(organization.id, { name: `Int client ${uid()}`, email });
    expect(first.status).toBe(201);

    const reused = await post(second.id, { name: `Int client ${uid()}`, email });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "CLIENT_EMAIL_CONFLICT", field: "email", error: expect.any(String) });
    expect(await db.client.count({ where: { organizationId: second.id } })).toBe(0);

    // The workspace-scoped pre-check still answers first inside one workspace.
    const duplicate = await post(organization.id, { name: `Int client ${uid()}`, email });
    expect(duplicate.status).toBe(400);

    // The connection survives the constraint violation: a different email in
    // the second workspace is created.
    const other = await post(second.id, { name: `Int client ${uid()}`, email: `int+client-${uid()}@invosmart.test` });
    expect(other.status).toBe(201);
  });
});
