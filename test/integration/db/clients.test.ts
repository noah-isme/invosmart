// CLI-INT-01: POST /api/clients and PUT /api/clients/[id] map the @@unique([userId, email]) violation
// (the same user reusing a client email in a second workspace) to a 409 with
// an error code instead of an unhandled 500. The desired per-workspace
// behaviour (201) needs a schema change; CLI-03b in the e2e suite keeps it
// documented as test.fail.
// @covers: /api/clients, /api/clients/[id] (route handlers called in-process; scripts/e2e-coverage-check.mjs)
import { describe, expect, it, vi } from "vitest";

import { POST as createClient } from "@/app/api/clients/route";
import { PUT as updateClient } from "@/app/api/clients/[id]/route";

import { createUserWithWorkspace, createWorkspace, db, request, routeParams, signInAs, uid } from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const put = (organizationId: string, id: string, body: Record<string, unknown>) =>
  updateClient(request(`/api/clients/${id}?organizationId=${organizationId}`, { method: "PUT", body }), routeParams({ id }));

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

  it("answers 409 CLIENT_EMAIL_CONFLICT when an update reuses an email the user has in another workspace", async () => {
    const { user, organization } = await createUserWithWorkspace();
    const second = await createWorkspace(user);
    signInAs(user);
    const email = `int+client-${uid()}@invosmart.test`;

    expect((await post(organization.id, { name: `Int client ${uid()}`, email })).status).toBe(201);
    const target = await (await post(second.id, { name: `Int client ${uid()}`, email: `int+client-${uid()}@invosmart.test` })).json();

    // Not caught by the workspace-scoped pre-check: only @@unique([userId, email]) fires.
    const reused = await put(second.id, target.data.id, { name: target.data.name, email });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "CLIENT_EMAIL_CONFLICT", field: "email", error: expect.any(String) });
    expect((await db.client.findUniqueOrThrow({ where: { id: target.data.id } })).email).not.toBe(email);

    // The workspace-scoped pre-check answers the same 409 inside one workspace.
    const sibling = await (await post(organization.id, { name: `Int client ${uid()}`, email: `int+client-${uid()}@invosmart.test` })).json();
    const duplicate = await put(organization.id, sibling.data.id, { name: sibling.data.name, email });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: "CLIENT_EMAIL_CONFLICT", field: "email" });

    // The connection survives the constraint violation and a fresh email is accepted.
    const ok = await put(second.id, target.data.id, { name: target.data.name, email: `int+client-${uid()}@invosmart.test` });
    expect(ok.status).toBe(200);
  });
});
