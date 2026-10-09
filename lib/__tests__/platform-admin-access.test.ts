import type { Session } from "next-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionFor = (id: string | undefined, email = "someone@example.com") =>
  ({ user: { id, email }, expires: "2099-01-01" }) as unknown as Session;

const load = async () => {
  vi.resetModules();
  return import("@/lib/devtools/access");
};

describe("platform admin access (isPlatformAdmin)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_USER_IDS", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAILS", "");
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    warn.mockRestore();
  });

  it("allows a user id listed in ADMIN_USER_IDS", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "cuid_other, cuid_admin ,");
    const { isPlatformAdmin } = await load();

    expect(isPlatformAdmin(sessionFor("cuid_admin"))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("denies an id that is not listed", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    const { isPlatformAdmin } = await load();

    expect(isPlatformAdmin(sessionFor("cuid_attacker"))).toBe(false);
  });

  it("denies a session whose email is in ADMIN_EMAILS when the id is not listed", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    const { isPlatformAdmin } = await load();

    expect(isPlatformAdmin(sessionFor("cuid_registered_attacker", "owner@example.com"))).toBe(false);
  });

  it("denies when there is no session or no user id", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    const { isPlatformAdmin } = await load();

    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin(sessionFor(undefined))).toBe(false);
  });

  it("denies everyone and warns once when ADMIN_USER_IDS is empty", async () => {
    const { isPlatformAdmin } = await load();

    expect(isPlatformAdmin(sessionFor("cuid_admin"))).toBe(false);
    expect(isPlatformAdmin(sessionFor("cuid_admin"))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ADMIN_USER_IDS is empty");
  });

  it("warns that ADMIN_EMAILS is deprecated when ADMIN_USER_IDS is empty, without logging addresses", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    const { warnAboutAdminConfig } = await load();

    warnAboutAdminConfig();
    warnAboutAdminConfig();

    expect(warn).toHaveBeenCalledTimes(2); // legacy-email warning + empty-ids warning, each once
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("ADMIN_EMAILS is deprecated");
    expect(logged).not.toContain("owner@example.com");
  });

  it("only notes ADMIN_EMAILS deprecation when ADMIN_USER_IDS is configured", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    vi.stubEnv("ADMIN_USER_IDS", "cuid_admin");
    const { warnAboutAdminConfig } = await load();

    warnAboutAdminConfig();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("deprecated and ignored");
  });

  it("only bypasses the allowlist in local development, never in test or production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let mod = await load();
    expect(mod.isPlatformAdmin(sessionFor("cuid_any"))).toBe(true);
    expect(mod.isPlatformAdmin(null)).toBe(false);
    expect(mod.isPlatformAdmin(sessionFor(undefined))).toBe(false);

    vi.stubEnv("NODE_ENV", "test");
    mod = await load();
    expect(mod.isPlatformAdmin(sessionFor("cuid_admin"))).toBe(false);
  });
});
