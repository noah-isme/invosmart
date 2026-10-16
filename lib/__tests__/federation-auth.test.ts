import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "fed-bearer-0123456789";

const request = (authorization?: string) =>
  new Request("http://localhost/api/federation/events", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });

const loadHelper = async () => {
  vi.resetModules();
  return import("@/lib/federation/auth");
};

describe("requireFederationBearer", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it("returns null for the correct bearer (scheme is case-insensitive)", async () => {
    vi.stubEnv("FEDERATION_TOKEN_SECRET", SECRET);
    const { requireFederationBearer } = await loadHelper();

    expect(requireFederationBearer(request(`Bearer ${SECRET}`))).toBeNull();
    expect(requireFederationBearer(request(`bearer ${SECRET}`))).toBeNull();
  });

  it("returns 401 for a missing, wrong, differently sized or non-bearer credential", async () => {
    vi.stubEnv("FEDERATION_TOKEN_SECRET", SECRET);
    const { requireFederationBearer } = await loadHelper();

    for (const header of [
      undefined,
      "Bearer ",
      `Bearer ${SECRET.replace(/.$/, "x")}`,
      `Bearer ${SECRET}extra`,
      `Bearer ${"y".repeat(5000)}`,
      `Basic ${SECRET}`,
      SECRET,
    ]) {
      expect(requireFederationBearer(request(header))?.status).toBe(401);
    }
  });

  it("fails closed with 503 in production when the secret is unset, warning once", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FEDERATION_TOKEN_SECRET", "   ");
    const { requireFederationBearer } = await loadHelper();

    expect(requireFederationBearer(request("Bearer anything"))?.status).toBe(503);
    expect(requireFederationBearer(request())?.status).toBe(503);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("FEDERATION_TOKEN_SECRET is not set");
  });

  it("returns 401 outside production when the secret is unset (never open)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FEDERATION_TOKEN_SECRET", "");
    const { requireFederationBearer } = await loadHelper();

    expect(requireFederationBearer(request("Bearer "))?.status).toBe(401);
    expect(requireFederationBearer(request("Bearer anything"))?.status).toBe(401);
  });
});
