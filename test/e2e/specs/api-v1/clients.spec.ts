// F19 Public API /api/v1 clients: API-09 mirrors API-01..05 for clients
// (plan .plans/e2e-scenarios.md, "F19 Public API /api/v1").
//
// Verified against app/api/v1/clients/** and lib/api-v1/*:
// - POST /api/v1/clients needs clients:write and an Idempotency-Key (missing ->
//   400 IDEMPOTENCY_KEY_REQUIRED); same key + same body replays the stored
//   client (201), a different body -> 409 IDEMPOTENCY_CONFLICT. A new key with
//   an email already used in the workspace -> 409 INVALID_REQUEST.
// - GET /api/v1/clients (clients:read) supports `q`; GET/PATCH/DELETE
//   /api/v1/clients/[id] look the id up inside the key's workspace (404
//   otherwise). Auth failures as for invoices: 401 revoked/unknown, 403 scope.
// - The workspace UI: /app/clients/[id] is server rendered from the session's
//   workspace (notFound() otherwise); GET /api/clients/[id] returns { data }.
import { expect, test, type ApiUser } from "../../fixtures";
import { covers, errorCode, idempotencyKey, uniqueName, v1Client, type V1Success } from "./v1";

type V1ApiClient = { id: string; name: string; email: string | null; organizationId: string };

const CLIENTS = "/api/v1/clients";
const clientBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`,
  currency: "IDR",
  ...extra,
});

const orgOf = (user: ApiUser) => user.user.workspace.organizationId;

test.describe("public API v1 clients (API-09)", () => {
  test(
    "API-09 (API-01/02/03) a clients:write key creates a client idempotently (replay, 409 conflict, 400 without key) and the workspace UI shows it",
    { annotation: covers(CLIENTS, "/api/v1/clients/[id]", "/app/clients/[id]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api09-create");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["clients:read", "clients:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const name = uniqueName("API-09");
      const key = idempotencyKey("api09");

      const missing = await v1.fetch("POST", CLIENTS, { data: clientBody(name) });
      expect(missing.status()).toBe(400);
      expect(await errorCode(missing)).toBe("IDEMPOTENCY_KEY_REQUIRED");

      const created = await v1.fetch("POST", CLIENTS, { data: clientBody(name), idempotencyKey: key });
      expect(created.status()).toBe(201);
      const client = ((await created.json()) as V1Success<V1ApiClient>).data;
      expect(client).toMatchObject({ name, organizationId: orgOf(owner) });

      const replay = await v1.fetch("POST", CLIENTS, { data: clientBody(name), idempotencyKey: key });
      expect(replay.status()).toBe(201);
      expect(((await replay.json()) as V1Success<V1ApiClient>).data).toEqual(client);

      const conflict = await v1.fetch("POST", CLIENTS, { data: clientBody(name, { notes: "changed" }), idempotencyKey: key });
      expect(conflict.status()).toBe(409);
      expect(await errorCode(conflict)).toBe("IDEMPOTENCY_CONFLICT");

      const list = await v1.fetch("GET", `${CLIENTS}?q=${encodeURIComponent(name)}`);
      expect(list.status()).toBe(200);
      expect(((await list.json()) as V1Success<V1ApiClient[]>).data.map((entry) => entry.id)).toEqual([client.id]);
      expect((await v1.fetch("GET", `${CLIENTS}/${client.id}`)).status()).toBe(200);

      const page = await owner.api.get(`/app/clients/${client.id}`);
      expect(page.status(), "GET /app/clients/[id]").toBe(200);
      expect(await page.text()).toContain(name);
      const session = await owner.api.get(`/api/clients/${client.id}`);
      expect(session.status(), "GET /api/clients/[id]").toBe(200);
      expect(((await session.json()) as { data: V1ApiClient }).data.name).toBe(name);
    },
  );

  test(
    "API-09 (API-04) a clients:read key is 403 on POST; revoked, unknown and missing keys are 401",
    { annotation: covers(CLIENTS, "/api/workspaces/[id]/api-keys/[keyId]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api09-scope");
      const org = orgOf(owner);
      const request = await _newRequestContext({ cookies: [], origins: [] });
      const readOnly = await owner.factory.createApiKey(org, { scopes: ["clients:read"] });
      const reader = v1Client(request, readOnly.token, guards);

      const denied = await reader.fetch("POST", CLIENTS, { data: clientBody(uniqueName("API-09 scope")), idempotencyKey: idempotencyKey("api09-scope") });
      expect(denied.status()).toBe(403);
      expect(await errorCode(denied)).toBe("FORBIDDEN");
      expect((await reader.fetch("GET", CLIENTS)).status(), "GET with clients:read").toBe(200);
      // A clients-only key has no invoice scope.
      expect((await reader.fetch("GET", "/api/v1/invoices")).status(), "GET invoices with clients:read").toBe(403);

      expect((await owner.api.delete(`/api/workspaces/${org}/api-keys/${readOnly.key.id}`)).status()).toBe(200);
      const afterRevoke = await reader.fetch("GET", CLIENTS);
      expect(afterRevoke.status()).toBe(401);
      expect(await errorCode(afterRevoke)).toBe("UNAUTHORIZED");
      const forged = `${readOnly.key.prefix}_${"B".repeat(43)}`;
      expect((await v1Client(request, forged, guards).fetch("GET", CLIENTS)).status(), "unknown key").toBe(401);
      expect((await v1Client(request, null, guards).fetch("GET", CLIENTS)).status(), "no key").toBe(401);
    },
  );

  test(
    "API-09 (API-05) a key from workspace A gets 404 for workspace B's client and 403 when selecting workspace B",
    { annotation: covers(CLIENTS, "/api/v1/clients/[id]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const a = await newApiUser("api09-a");
      const b = await newApiUser("api09-b");
      const { token } = await a.factory.createApiKey(orgOf(a), { scopes: ["clients:read", "clients:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const bClient = await b.factory.createClient({ name: uniqueName("API-09 B") });

      for (const [method, data] of [["GET", undefined], ["PATCH", { notes: "hijack" }], ["DELETE", undefined]] as const) {
        const response = await v1.fetch(method, `${CLIENTS}/${bClient.id}`, { data });
        expect(response.status(), `${method} B's client`).toBe(404);
        expect(await errorCode(response)).toBe("NOT_FOUND");
      }
      const list = await v1.fetch("GET", CLIENTS);
      expect(((await list.json()) as V1Success<V1ApiClient[]>).data.map((entry) => entry.id)).not.toContain(bClient.id);
      expect((await v1.fetch("GET", CLIENTS, { headers: { "x-organization-id": orgOf(b) } })).status(), "x-organization-id B").toBe(403);

      const intact = await b.api.get(`/api/clients/${bClient.id}`);
      expect(intact.status()).toBe(200);
      expect(((await intact.json()) as { data: { notes: string | null } }).data.notes).not.toBe("hijack");
    },
  );
});
