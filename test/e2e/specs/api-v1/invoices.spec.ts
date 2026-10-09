// F19 Public API /api/v1 invoices: API-01..07 (plan .plans/e2e-scenarios.md,
// "F19 Public API /api/v1"). Runs in the `api` project (no setup dependency):
// every test makes its own users with newApiUser and its own keys with the
// workspace API (createApiKey -> POST /api/workspaces/[id]/api-keys).
//
// Verified against docs/API.md, app/api/v1/invoices/**, lib/api-v1/* and
// lib/api-keys.ts:
// - POST /api/v1/invoices needs scope invoices:write and an Idempotency-Key
//   (missing -> 400 IDEMPOTENCY_KEY_REQUIRED, checked after auth/scope). The
//   key is stored per workspace with a fingerprint of the parsed body: same
//   key + same body -> the stored result again (201, same invoice); same key +
//   different body -> 409 IDEMPOTENCY_CONFLICT. Process-local store because
//   UPSTASH_* / KV_* are blank in e2e.
// - Auth (lib/api-v1/auth.ts): no/unknown/revoked/expired key -> 401
//   UNAUTHORIZED; valid key without the scope -> 403 FORBIDDEN; asking for
//   another workspace (x-organization-id / ?organizationId=) -> 403.
//   Resources are looked up inside the key's workspace, so another
//   workspace's id -> 404 NOT_FOUND.
// - Expired keys: POST /api/workspaces/[id]/api-keys rejects a past expiresAt
//   with 400, so an expired key cannot be made over HTTP. The 401 for an
//   expired key is covered by the integration layer
//   (test/integration/db/api-keys.test.ts, "API-04 expired API key").
// - Revocation: DELETE /api/workspaces/[id]/api-keys/[keyId] sets revokedAt.
// - GET /api/v1/invoices: limit 1..100, ordered (createdAt desc, id desc),
//   meta { nextCursor, hasMore, limit }; cursor = base64url {createdAt, id}.
// - Rate limit (lib/api-v1/rate-limit.ts): fixed 60 s window, 120 requests per
//   (bucket, identifier); identifier = key id for a valid key (else client IP).
//   Every authorised response carries x-ratelimit-limit/-remaining/-reset; a
//   429 RATE_LIMITED adds retry-after. API-07 uses its own key, so no other
//   test shares its bucket.
import { expect, test, EXPECTS_429, type ApiUser } from "../../fixtures";
import { covers, errorCode, idempotencyKey, uniqueName, v1Client, type V1Success } from "./v1";

type V1Invoice = {
  id: string;
  number: string;
  client: string;
  total: number;
  status: string;
  organizationId: string;
  createdAt: string;
};

const INVOICES = "/api/v1/invoices";
const invoiceBody = (client: string, price = 250_000) => ({
  client,
  items: [{ name: "E2E API line", qty: 2, price }],
  taxRate: 0.1,
  currency: "IDR",
  dueAt: null,
});

const orgOf = (user: ApiUser) => user.user.workspace.organizationId;

test.describe("public API v1 invoices", () => {
  test(
    "API-01 a key with invoices:write creates an invoice with an Idempotency-Key (201) that the workspace sees in its UI",
    { tag: "@smoke", annotation: covers(INVOICES, "/api/v1/invoices/[id]", "/app/invoices/[id]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api01");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read", "invoices:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const client = uniqueName("API-01");

      const created = await v1.fetch("POST", INVOICES, { data: invoiceBody(client), idempotencyKey: idempotencyKey("api01") });
      expect(created.status()).toBe(201);
      for (const header of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
        expect(created.headers()[header], header).toMatch(/^\d+$/);
      }
      const invoice = ((await created.json()) as V1Success<V1Invoice>).data;
      expect(invoice).toMatchObject({ client, status: "DRAFT", organizationId: orgOf(owner), subtotal: 500_000, tax: 50_000, total: 550_000 });

      const read = await v1.fetch("GET", `${INVOICES}/${invoice.id}`);
      expect(read.status()).toBe(200);
      expect(((await read.json()) as V1Success<V1Invoice>).data.id).toBe(invoice.id);

      // The workspace's own session sees it: the server-rendered detail page and the session API.
      const page = await owner.api.get(`/app/invoices/${invoice.id}`);
      expect(page.status(), "GET /app/invoices/[id]").toBe(200);
      expect(await page.text()).toContain(client);
      const session = await owner.api.get(`/api/invoices/${invoice.id}`);
      expect(session.status(), "GET /api/invoices/[id]").toBe(200);
      expect(await session.text()).toContain(invoice.id);
    },
  );

  test(
    "API-02 repeating the same Idempotency-Key and body replays the same invoice; a different body is 409 IDEMPOTENCY_CONFLICT",
    { tag: "@smoke", annotation: covers(INVOICES) },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api02");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read", "invoices:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const client = uniqueName("API-02");
      const key = idempotencyKey("api02");

      const first = await v1.fetch("POST", INVOICES, { data: invoiceBody(client), idempotencyKey: key });
      expect(first.status()).toBe(201);
      const original = ((await first.json()) as V1Success<V1Invoice>).data;

      const replay = await v1.fetch("POST", INVOICES, { data: invoiceBody(client), idempotencyKey: key });
      expect(replay.status()).toBe(201);
      expect(((await replay.json()) as V1Success<V1Invoice>).data).toEqual(original);

      const conflict = await v1.fetch("POST", INVOICES, { data: invoiceBody(client, 999_000), idempotencyKey: key });
      expect(conflict.status()).toBe(409);
      expect(await errorCode(conflict)).toBe("IDEMPOTENCY_CONFLICT");

      // Exactly one invoice exists for this client.
      const list = await v1.fetch("GET", `${INVOICES}?q=${encodeURIComponent(client)}`);
      expect(list.status()).toBe(200);
      expect(((await list.json()) as V1Success<V1Invoice[]>).data.map((entry) => entry.id)).toEqual([original.id]);
    },
  );

  test(
    "API-03 POST /api/v1/invoices without an Idempotency-Key is 400 and creates nothing",
    { annotation: covers(INVOICES) },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api03");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read", "invoices:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const client = uniqueName("API-03");

      const missing = await v1.fetch("POST", INVOICES, { data: invoiceBody(client) });
      expect(missing.status()).toBe(400);
      expect(await errorCode(missing)).toBe("IDEMPOTENCY_KEY_REQUIRED");

      const list = await v1.fetch("GET", `${INVOICES}?q=${encodeURIComponent(client)}`);
      expect(((await list.json()) as V1Success<V1Invoice[]>).data).toEqual([]);
    },
  );

  test(
    "API-04 an invoices:read key is 403 on POST; a revoked key, an unknown key and no key are 401; a past expiresAt cannot be created (400)",
    { annotation: covers(INVOICES, "/api/workspaces/[id]/api-keys", "/api/workspaces/[id]/api-keys/[keyId]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api04");
      const org = orgOf(owner);
      const request = await _newRequestContext({ cookies: [], origins: [] });

      const readOnly = await owner.factory.createApiKey(org, { scopes: ["invoices:read"] });
      const reader = v1Client(request, readOnly.token, guards);
      const denied = await reader.fetch("POST", INVOICES, { data: invoiceBody(uniqueName("API-04")), idempotencyKey: idempotencyKey("api04") });
      expect(denied.status()).toBe(403);
      expect(await errorCode(denied)).toBe("FORBIDDEN");
      expect((await reader.fetch("GET", INVOICES)).status(), "GET with invoices:read").toBe(200);

      // Revoked.
      const revoked = await owner.api.delete(`/api/workspaces/${org}/api-keys/${readOnly.key.id}`);
      expect(revoked.status(), "DELETE api key").toBe(200);
      const afterRevoke = await reader.fetch("GET", INVOICES);
      expect(afterRevoke.status()).toBe(401);
      expect(await errorCode(afterRevoke)).toBe("UNAUTHORIZED");

      // Unknown (well-formed) key and no key at all.
      const forged = `${readOnly.key.prefix}_${"A".repeat(43)}`;
      expect((await v1Client(request, forged, guards).fetch("GET", INVOICES)).status(), "unknown key").toBe(401);
      expect((await v1Client(request, null, guards).fetch("GET", INVOICES)).status(), "no key").toBe(401);

      // Expired keys cannot be created over HTTP; their 401 is covered in
      // test/integration/db/api-keys.test.ts.
      const expired = await owner.api.post(`/api/workspaces/${org}/api-keys`, {
        data: { name: uniqueName("API-04 expired"), scopes: ["invoices:read"], expiresAt: new Date(Date.now() - 60_000).toISOString() },
      });
      expect(expired.status(), "create key with a past expiresAt").toBe(400);
    },
  );

  test(
    "API-05 a key from workspace A cannot read, change or delete workspace B's invoice (404) nor select workspace B (403)",
    { annotation: covers(INVOICES, "/api/v1/invoices/[id]") },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const a = await newApiUser("api05-a");
      const b = await newApiUser("api05-b");
      const { token } = await a.factory.createApiKey(orgOf(a), { scopes: ["invoices:read", "invoices:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);
      const bInvoice = await b.factory.createInvoice({ client: uniqueName("API-05 B") });

      for (const [method, data] of [["GET", undefined], ["PATCH", { notes: "hijack" }], ["DELETE", undefined]] as const) {
        const response = await v1.fetch(method, `${INVOICES}/${bInvoice.id}`, { data });
        expect(response.status(), `${method} B's invoice`).toBe(404);
        expect(await errorCode(response)).toBe("NOT_FOUND");
      }
      const list = await v1.fetch("GET", INVOICES);
      expect(((await list.json()) as V1Success<V1Invoice[]>).data.map((entry) => entry.id)).not.toContain(bInvoice.id);
      expect((await v1.fetch("GET", INVOICES, { headers: { "x-organization-id": orgOf(b) } })).status(), "x-organization-id B").toBe(403);
      expect((await v1.fetch("GET", `${INVOICES}?organizationId=${orgOf(b)}`)).status(), "?organizationId=B").toBe(403);

      // B's invoice is intact.
      const intact = await b.api.get(`/api/invoices/${bInvoice.id}`);
      expect(intact.status()).toBe(200);
      expect(await intact.text()).not.toContain("hijack");
    },
  );

  test(
    "API-06 limit=2 over five invoices pages through three cursors with no duplicates and nothing missing",
    { annotation: covers(INVOICES) },
    async ({ newApiUser, guards, _newRequestContext }) => {
      const owner = await newApiUser("api06");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read", "invoices:write"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);

      const createdIds: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const response = await v1.fetch("POST", INVOICES, {
          data: invoiceBody(uniqueName(`API-06 #${index}`)),
          idempotencyKey: idempotencyKey(`api06-${index}`),
        });
        expect(response.status()).toBe(201);
        createdIds.push(((await response.json()) as V1Success<V1Invoice>).data.id);
      }

      const pages: V1Success<V1Invoice[]>[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : "?limit=2";
        const response = await v1.fetch("GET", `${INVOICES}${query}`);
        expect(response.status()).toBe(200);
        const page = (await response.json()) as V1Success<V1Invoice[]>;
        pages.push(page);
        cursor = page.meta!.nextCursor;
        expect(pages.length, "page count stays bounded").toBeLessThanOrEqual(3);
      } while (cursor);

      expect(pages.map((page) => page.data.length)).toEqual([2, 2, 1]);
      expect(pages.map((page) => page.meta!.hasMore)).toEqual([true, true, false]);
      expect(pages.every((page) => page.meta!.limit === 2)).toBe(true);
      const seen = pages.flatMap((page) => page.data.map((entry) => entry.id));
      expect(new Set(seen).size, "no duplicates").toBe(seen.length);
      expect([...seen].sort()).toEqual([...createdIds].sort());
      // Newest first.
      const createdAt = pages.flatMap((page) => page.data.map((entry) => Date.parse(entry.createdAt)));
      expect(createdAt).toEqual([...createdAt].sort((left, right) => right - left));

      expect((await v1.fetch("GET", `${INVOICES}?limit=2&cursor=not-a-cursor`)).status(), "invalid cursor").toBe(400);
    },
  );

  test(
    "API-07 a key sending requests until the first 429 gets Retry-After and X-RateLimit-* headers",
    { annotation: [{ type: EXPECTS_429, description: "rate limit is the subject of this test" }, ...covers(INVOICES)] },
    async ({ newApiUser, guards, _newRequestContext }) => {
      // A dedicated user, workspace and key: the limiter is keyed by key id and bucket.
      const owner = await newApiUser("api07");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);

      const first = await v1.fetch("GET", `${INVOICES}?limit=1`);
      expect(first.status()).toBe(200);
      const limit = Number(first.headers()["x-ratelimit-limit"]);
      expect(limit).toBeGreaterThan(0);
      expect(Number(first.headers()["x-ratelimit-remaining"])).toBe(limit - 1);

      const cap = 2 * limit + 1;
      let sent = 1;
      let limited: Awaited<ReturnType<typeof v1.fetch>> | undefined;
      let previousRemaining = limit - 1;
      while (sent < cap) {
        const response = await v1.fetch("GET", `${INVOICES}?limit=1`);
        sent += 1;
        if (response.status() === 429) {
          limited = response;
          break;
        }
        expect(response.status(), `request #${sent}`).toBe(200);
        const remaining = Number(response.headers()["x-ratelimit-remaining"]);
        expect(remaining, `remaining decreases (request #${sent})`).toBeLessThan(previousRemaining);
        previousRemaining = remaining;
      }

      expect(limited, `a 429 within ${cap} requests`).toBeDefined();
      test.info().annotations.push({ type: "observed", description: `first 429 at request #${sent} with x-ratelimit-limit ${limit}` });
      // The window admits only limit - 1 requests (API-07b records that as a
      // product bug); accept either boundary here so API-07 tests the 429 contract.
      expect(sent, "the 429 arrives once the limit is used up").toBeGreaterThanOrEqual(limit);
      expect(sent).toBeLessThanOrEqual(limit + 1);
      const headers = limited!.headers();
      expect(Number(headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(Number(headers["retry-after"])).toBeLessThanOrEqual(60);
      expect(headers["x-ratelimit-limit"]).toBe(String(limit));
      expect(headers["x-ratelimit-remaining"]).toBe("0");
      expect(Number(headers["x-ratelimit-reset"])).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000));
      expect(await errorCode(limited!)).toBe("RATE_LIMITED");

      // Buckets are per operation: the same key can still read a single invoice route.
      expect((await v1.fetch("GET", `${INVOICES}/does-not-exist`)).status(), "other bucket").toBe(404);
    },
  );

  test(
    "API-07b a key may send x-ratelimit-limit requests in one window before the first 429",
    { annotation: [{ type: EXPECTS_429, description: "the boundary request is refused (product bug)" }, ...covers(INVOICES)] },
    async ({ newApiUser, guards, _newRequestContext }) => {
      // PRODUCT BUG (off by one), lib/api-v1/rate-limit.ts: consumeLocal() counts
      // the request first and isRateLimited() refuses when remaining <= 0, so the
      // request that brings the count to `limit` is already a 429. With
      // x-ratelimit-limit 120 only 119 requests succeed, and request #119 reports
      // x-ratelimit-remaining 1 although the next one is refused. Observed in
      // API-07: "first 429 at request #120 with x-ratelimit-limit 120".
      test.fail(true, "lib/api-v1/rate-limit.ts refuses the limit-th request (off by one)");
      const owner = await newApiUser("api07b");
      const { token } = await owner.factory.createApiKey(orgOf(owner), { scopes: ["invoices:read"] });
      const v1 = v1Client(await _newRequestContext({ cookies: [], origins: [] }), token, guards);

      const first = await v1.fetch("GET", `${INVOICES}?limit=1`);
      expect(first.status()).toBe(200);
      const limit = Number(first.headers()["x-ratelimit-limit"]);
      for (let sent = 2; sent <= limit; sent += 1) {
        const response = await v1.fetch("GET", `${INVOICES}?limit=1`);
        expect(response.status(), `request #${sent} of ${limit}`).toBe(200);
      }
    },
  );
});
