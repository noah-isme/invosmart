import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/server/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/ai/federationAgent", () => ({
  getFederationAgent: () => ({
    broadcastLocalSnapshot: vi.fn(),
    getSnapshots: () => [],
    getTrustHistory: () => [],
    getModelHistory: () => [],
  }),
}));
vi.mock("@/lib/federation/bus", () => ({
  federationBus: { isEnabled: false, checkConnections: vi.fn(), getStatus: () => ({}) },
}));

const getServerSessionMock = vi.mocked(getServerSession);

const SECRET = "fed-secret-value-0123456789";
const admin = { user: { id: "cuid_admin", email: "a@example.com" }, expires: "2099-01-01" };
const nonAdmin = { user: { id: "cuid_user", email: "owner@example.com" }, expires: "2099-01-01" };

const request = (authorization?: string) =>
  new Request("http://localhost/api/federation/status", {
    headers: authorization ? { authorization } : {},
  });

const loadRoute = async () => {
  vi.resetModules();
  return import("@/app/api/federation/status/route");
};

describe("GET /api/federation/status authorisation", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    vi.stubEnv("ADMIN_EMAILS", "");
    getServerSessionMock.mockResolvedValue(null);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  describe("FEDERATION_TOKEN_SECRET unset or blank (fail closed)", () => {
    for (const value of ["", "   "]) {
      const label = value === "" ? "unset/empty" : "blank";

      it(`${label}: no session is denied, even with a bearer token`, async () => {
        vi.stubEnv("FEDERATION_TOKEN_SECRET", value);
        const { GET, POST } = await loadRoute();

        expect((await GET(request())).status).toBe(401);
        expect((await GET(request("Bearer anything"))).status).toBe(401);
        expect((await GET(request("Bearer "))).status).toBe(401);
        expect((await POST(request("Bearer "))).status).toBe(401);
      });

      it(`${label}: a non-admin session gets 403`, async () => {
        vi.stubEnv("FEDERATION_TOKEN_SECRET", value);
        getServerSessionMock.mockResolvedValue(nonAdmin);
        const { GET } = await loadRoute();

        expect((await GET(request())).status).toBe(403);
      });

      it(`${label}: a platform-admin session gets 200`, async () => {
        vi.stubEnv("FEDERATION_TOKEN_SECRET", value);
        getServerSessionMock.mockResolvedValue(admin);
        const { GET } = await loadRoute();

        expect((await GET(request())).status).toBe(200);
      });
    }

    it("warns once in production without printing secret material", async () => {
      vi.stubEnv("FEDERATION_TOKEN_SECRET", "");
      const { GET } = await loadRoute();

      await GET(request());
      await GET(request());

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("FEDERATION_TOKEN_SECRET is not set");
    });
  });

  describe("FEDERATION_TOKEN_SECRET set", () => {
    beforeEach(() => {
      vi.stubEnv("FEDERATION_TOKEN_SECRET", SECRET);
    });

    it("accepts the correct bearer token without a session", async () => {
      const { GET, POST } = await loadRoute();

      expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
      expect((await GET(request(`bearer ${SECRET}`))).status).toBe(200);
      expect((await POST(request(`Bearer ${SECRET}`))).status).toBe(200);
      expect(warn).not.toHaveBeenCalled();
    });

    it("rejects a wrong bearer token", async () => {
      const { GET } = await loadRoute();

      expect((await GET(request(`Bearer ${SECRET.replace(/.$/, "x")}`))).status).toBe(401);
    });

    it("rejects bearer tokens of a different length without throwing", async () => {
      const { GET } = await loadRoute();

      for (const token of ["x", SECRET.slice(0, -1), `${SECRET}extra`, "y".repeat(5000)]) {
        const res = await GET(request(`Bearer ${token}`));
        expect(res.status).toBe(401);
      }
    });

    it("rejects non-bearer schemes", async () => {
      const { GET } = await loadRoute();

      expect((await GET(request(`Basic ${SECRET}`))).status).toBe(401);
      expect((await GET(request(SECRET))).status).toBe(401);
    });

    it("still lets a platform-admin session in (DevTools UI sends no bearer)", async () => {
      getServerSessionMock.mockResolvedValue(admin);
      const { GET } = await loadRoute();

      expect((await GET(request())).status).toBe(200);
    });

    it("a wrong bearer does not shadow a non-admin session: 403", async () => {
      getServerSessionMock.mockResolvedValue(nonAdmin);
      const { GET } = await loadRoute();

      expect((await GET(request("Bearer nope"))).status).toBe(403);
    });
  });
});
