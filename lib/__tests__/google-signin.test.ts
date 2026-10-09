import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const delegates = () => ({ user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } });
  const root = { ...delegates(), $transaction: vi.fn() };
  const tx = {
    ...delegates(),
    organization: { create: vi.fn() },
    membership: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  };
  return { root, tx, logAuditEvent: vi.fn(async () => undefined) };
});

vi.mock("@/lib/db", () => ({ db: mocks.root }));
vi.mock("@/lib/hash", () => ({ hash: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/audit/auditLogger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/auditLogger")>(
    "@/lib/audit/auditLogger",
  );
  return { ...actual, logAuditEvent: mocks.logAuditEvent };
});

const { root, tx } = mocks;

type Profile = { email_verified?: unknown } | undefined;

const callSignIn = async (opts: { profile?: Profile; provider?: string } = {}) => {
  const { authOptions } = await import("@/server/auth");
  const user: { id?: string; email: string | null; name: string | null } = {
    id: "google-sub",
    email: "Ari@Example.com",
    name: "Ari",
  };
  const result = await authOptions.callbacks!.signIn!({
    user,
    account: {
      provider: opts.provider ?? "google",
      type: "oauth",
      providerAccountId: "google-sub",
    },
    profile: "profile" in opts ? opts.profile : { sub: "google-sub", email_verified: true },
  } as never);
  return { result, user };
};

const expectNoWrites = () => {
  expect(root.user.create).not.toHaveBeenCalled();
  expect(root.user.update).not.toHaveBeenCalled();
  expect(root.$transaction).not.toHaveBeenCalled();
  expect(tx.user.create).not.toHaveBeenCalled();
  expect(tx.user.update).not.toHaveBeenCalled();
  expect(tx.organization.create).not.toHaveBeenCalled();
  expect(tx.membership.create).not.toHaveBeenCalled();
};

describe("Google signIn callback", () => {
  beforeEach(() => {
    for (const group of [root, tx]) {
      for (const fn of Object.values(group.user)) fn.mockReset();
    }
    root.$transaction.mockReset();
    root.$transaction.mockImplementation(async (fn: (c: unknown) => Promise<unknown>) => fn(tx));
    tx.organization.create.mockReset().mockResolvedValue({ id: "org-new", name: "Ari's Workspace" });
    tx.membership.findFirst.mockReset().mockResolvedValue(null);
    tx.membership.create.mockReset().mockResolvedValue({
      id: "m-new",
      organizationId: "org-new",
      userId: "user-new",
      role: "OWNER",
    });
    tx.user.create.mockResolvedValue({ id: "user-new", name: "Ari", email: "ari@example.com" });
    mocks.logAuditEvent.mockClear();
  });

  for (const [label, profile] of [
    ["false", { email_verified: false }],
    ["missing", {}],
    ["no profile", undefined],
    ['string "true"', { email_verified: "true" }],
  ] as const) {
    it(`rejects an unverified email (${label}) with a safe redirect and no DB access`, async () => {
      const { result } = await callSignIn({ profile });

      expect(result).toBe("/auth/login?error=GoogleEmailNotVerified");
      expect(root.user.findUnique).not.toHaveBeenCalled();
      expectNoWrites();
    });
  }

  it("provisions a verified new user with a personal workspace", async () => {
    root.user.findUnique.mockResolvedValue(null);

    const { result, user } = await callSignIn();

    expect(result).toBe(true);
    expect(user.id).toBe("user-new");
    expect(tx.user.create).toHaveBeenCalledWith({
      data: { email: "ari@example.com", name: "Ari", password: null },
    });
    expect(tx.organization.create).toHaveBeenCalledTimes(1);
    expect(tx.membership.create).toHaveBeenCalledTimes(1);
  });

  it("allows a verified existing Google-only user (no password)", async () => {
    root.user.findUnique.mockResolvedValue({ id: "user-g", email: "ari@example.com", password: null });
    root.user.update.mockResolvedValue({ id: "user-g", email: "ari@example.com", name: "Ari" });

    const { result, user } = await callSignIn();

    expect(result).toBe(true);
    expect(user.id).toBe("user-g");
    expect(root.user.update).toHaveBeenCalledWith({
      where: { email: "ari@example.com" },
      data: { name: "Ari" },
    });
    expect(root.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to link an existing password account and does not update it", async () => {
    root.user.findUnique.mockResolvedValue({
      id: "user-pw",
      email: "ari@example.com",
      password: "scrypt-hash",
    });

    const { result, user } = await callSignIn();

    expect(result).toBe("/auth/login?error=GooglePasswordAccountExists");
    expect(user.id).toBe("google-sub"); // not rewritten to the existing account
    expectNoWrites();
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-pw",
        details: { provider: "google", reason: "password_account_exists" },
      }),
    );
  });

  it("refuses when a concurrent password registration wins the unique email race", async () => {
    root.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-pw", email: "ari@example.com", password: "scrypt-hash" });
    root.$transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const { result } = await callSignIn();

    expect(result).toBe("/auth/login?error=GooglePasswordAccountExists");
    expect(root.user.update).not.toHaveBeenCalled();
  });

  it("returns a safe redirect and never throws on a DB error, leaking no raw message", async () => {
    const secret = 'Invalid `prisma.user.findUnique()` invocation: email "ari@example.com" at db.internal:5432';
    root.user.findUnique.mockRejectedValue(new Error(secret));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = await callSignIn();

    expect(result).toBe("/auth/login?error=OAuthCallback");
    expect(String(result)).not.toContain("prisma");
    expect(String(result)).not.toContain("ari@example.com");
    expect(String(result)).not.toContain("db.internal");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("ari@example.com");
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("returns a safe redirect when workspace provisioning fails", async () => {
    root.user.findUnique.mockResolvedValue(null);
    root.$transaction.mockRejectedValue(new Error("connection refused 10.0.0.5"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = await callSignIn();

    expect(result).toBe("/auth/login?error=OAuthCallback");
    consoleError.mockRestore();
  });

  it("does not touch non-Google providers", async () => {
    const { result } = await callSignIn({ provider: "credentials", profile: undefined });

    expect(result).toBe(true);
    expect(root.user.findUnique).not.toHaveBeenCalled();
  });
});
