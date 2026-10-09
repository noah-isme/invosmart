// API-04 expired-key path. The workspace API rejects a past expiresAt on
// create (app/api/workspaces/[id]/api-keys/route.ts superRefine), so the key
// is created through the API with a future expiry and backdated in the DB.
import { describe, expect, it, vi } from "vitest";

import { POST as createApiKey } from "@/app/api/workspaces/[id]/api-keys/route";
import { GET as listV1Invoices } from "@/app/api/v1/invoices/route";

import { createInvoice, createUserWithWorkspace, db, request, routeParams, signInAs, waitFor } from "./harness/fixtures";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const createKey = (organizationId: string, expiresAt: string) =>
  createApiKey(
    request(`/api/workspaces/${organizationId}/api-keys`, {
      method: "POST",
      body: { name: "Integration key", scopes: ["invoices:read"], expiresAt },
    }),
    routeParams({ id: organizationId }),
  );

const v1List = (token: string) =>
  listV1Invoices(request("/api/v1/invoices", { headers: { authorization: `Bearer ${token}` } }));

describe("API-04 expired API key", () => {
  it("the API refuses to create a key that is already expired", async () => {
    const { user, organization } = await createUserWithWorkspace();
    signInAs(user);
    const res = await createKey(organization.id, new Date(Date.now() - 60_000).toISOString());
    expect(res.status).toBe(400);
    expect(await db.apiKey.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("a key whose expiresAt has passed gets 401 from /api/v1", async () => {
    const { user, organization } = await createUserWithWorkspace();
    await createInvoice({ userId: user.id, organizationId: organization.id });
    signInAs(user);

    const created = await createKey(organization.id, new Date(Date.now() + 60 * 60_000).toISOString());
    expect(created.status).toBe(201);
    const { token, data } = (await created.json()) as { token: string; data: { id: string } };
    await waitFor(() => db.auditLog.findFirst({ where: { entityId: data.id, action: "API_KEY_CREATE" } }));

    // Positive control: the same key works while it is valid.
    const valid = await v1List(token);
    expect(valid.status).toBe(200);
    // verifyApiKey records lastUsedAt fire-and-forget; let it land first.
    await waitFor(async () => (await db.apiKey.findUnique({ where: { id: data.id } }))?.lastUsedAt);

    await db.apiKey.update({ where: { id: data.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const expired = await v1List(token);
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toBe("Bearer");
    const body = await expired.json();
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
