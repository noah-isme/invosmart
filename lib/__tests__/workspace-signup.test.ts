import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimiters } from "@/lib/rate-limit";
import { ensurePersonalWorkspace } from "@/lib/workspace-provisioning";
import {
  createUserWithPersonalWorkspace,
  provisionPersonalWorkspace,
  resolveWorkspaceContext,
  type WorkspaceDatabase,
} from "@/lib/workspaces";

type Delegates = {
  user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  organization: { create: ReturnType<typeof vi.fn> };
  membership: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const mocks = vi.hoisted(() => {
  const delegates = (): Delegates => ({
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    organization: { create: vi.fn() },
    membership: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  });

  // `root` is the non-transactional client; `tx` is what the transaction
  // callback receives. Keeping them separate lets tests prove that every write
  // happened inside the transaction.
  const root = { ...delegates(), $transaction: vi.fn() };
  const tx = delegates();
  return { root, tx, delegates };
});

vi.mock("@/lib/db", () => ({ db: mocks.root }));
vi.mock("@/lib/hash", () => ({
  hash: vi.fn(async (value: string) => `hashed-${value}`),
  verify: vi.fn(),
}));
vi.mock("@/lib/audit/auditLogger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit/auditLogger")>(
    "@/lib/audit/auditLogger",
  );
  return { ...actual, logAuditEvent: vi.fn(async () => undefined) };
});

const { root, tx } = mocks;

const registerRequest = () =>
  new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Ari", email: "ari@example.com", password: "rahasia123" }),
  });

const resetAll = () => {
  for (const group of [root, tx]) {
    for (const key of ["user", "organization", "membership"] as const) {
      for (const fn of Object.values(group[key])) {
        (fn as ReturnType<typeof vi.fn>).mockReset();
      }
    }
  }
  root.$transaction.mockReset();
  root.$transaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
  clearRateLimiters();

  tx.user.create.mockResolvedValue({ id: "user-new", name: "Ari", email: "ari@example.com" });
  tx.membership.findFirst.mockResolvedValue(null);
  tx.organization.create.mockResolvedValue({ id: "org-new", name: "Ari's Workspace" });
  tx.membership.create.mockResolvedValue({
    id: "membership-new",
    organizationId: "org-new",
    userId: "user-new",
    role: "OWNER",
  });
};

const expectWorkspaceProvisionedInTransaction = () => {
  expect(root.$transaction).toHaveBeenCalledTimes(1);

  expect(tx.user.create).toHaveBeenCalledWith({
    data: { name: "Ari", email: "ari@example.com", password: "hashed-rahasia123" },
  });
  expect(tx.organization.create).toHaveBeenCalledWith({
    data: { name: "Ari's Workspace", defaultCurrency: "IDR" },
  });
  expect(tx.membership.create).toHaveBeenCalledWith({
    data: { organizationId: "org-new", userId: "user-new", role: "OWNER" },
    include: { organization: true },
  });
  expect(tx.user.update).toHaveBeenCalledWith({
    where: { id: "user-new" },
    data: { activeOrganizationId: "org-new" },
  });

  // Nothing was written outside the transaction.
  expect(root.user.create).not.toHaveBeenCalled();
  expect(root.organization.create).not.toHaveBeenCalled();
  expect(root.membership.create).not.toHaveBeenCalled();
  expect(root.user.update).not.toHaveBeenCalled();
};

describe("registration provisions a personal workspace", () => {
  beforeEach(resetAll);
  afterEach(() => vi.unstubAllEnvs());

  for (const mode of ["enforce", "compat"] as const) {
    it(`creates user, organization, OWNER membership and active workspace in one transaction (${mode})`, async () => {
      vi.stubEnv("WORKSPACE_AUTH_MODE", mode);
      root.user.findUnique.mockResolvedValue(null);

      const { POST } = await import("@/app/api/auth/register/route");
      const response = await POST(registerRequest());

      expect(response.status).toBe(201);
      expectWorkspaceProvisionedInTransaction();
    });
  }

  it("lets the new user resolve to their OWNER workspace under enforce (signup -> first request)", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "enforce");
    root.user.findUnique.mockResolvedValue(null);

    const { POST } = await import("@/app/api/auth/register/route");
    expect((await POST(registerRequest())).status).toBe(201);

    // Read-your-writes view of what the signup transaction persisted.
    const stored = {
      id: "membership-new",
      organizationId: "org-new",
      userId: "user-new",
      role: "OWNER",
      organization: { id: "org-new", name: "Ari's Workspace" },
    };
    const activeOrganizationId = tx.user.update.mock.calls[0][0].data.activeOrganizationId;
    const afterSignup = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-new",
          name: "Ari",
          email: "ari@example.com",
          activeOrganizationId,
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
      membership: {
        findUnique: vi.fn().mockResolvedValue(stored),
        findFirst: vi.fn().mockResolvedValue(stored),
        create: vi.fn(),
      },
      organization: { create: vi.fn() },
    } as unknown as WorkspaceDatabase;

    const context = await resolveWorkspaceContext("user-new", undefined, afterSignup);

    expect(context).toMatchObject({ userId: "user-new", organizationId: "org-new", role: "OWNER" });
  });

  it("returns 409 for a duplicate email and creates no workspace", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "enforce");
    root.user.findUnique.mockResolvedValue({ id: "user-existing", email: "ari@example.com" });

    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(registerRequest());

    expect(response.status).toBe(409);
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.membership.create).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent signup wins the unique email race", async () => {
    root.user.findUnique.mockResolvedValue(null);
    root.$transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const { POST } = await import("@/app/api/auth/register/route");
    const response = await POST(registerRequest());

    expect(response.status).toBe(409);
  });
});

describe("OAuth first sign-in provisions a personal workspace", () => {
  beforeEach(resetAll);

  const signIn = async () => {
    const { authOptions } = await import("@/server/auth");
    const user = { id: "ignored", email: "Ari@Example.com", name: "Ari" };
    const result = await authOptions.callbacks!.signIn!({
      user,
      account: { provider: "google", type: "oauth", providerAccountId: "g-1" },
      profile: { sub: "g-1", email: "Ari@Example.com", email_verified: true },
    } as never);
    return { result, user };
  };

  it("creates user and workspace in one transaction for a new Google user", async () => {
    root.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue({ id: "user-new", name: "Ari", email: "ari@example.com" });

    const { result, user } = await signIn();

    expect(result).toBe(true);
    expect(user.id).toBe("user-new");
    expect(root.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: { email: "ari@example.com", name: "Ari", password: null },
    });
    expect(tx.organization.create).toHaveBeenCalledTimes(1);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { organizationId: "org-new", userId: "user-new", role: "OWNER" },
      include: { organization: true },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-new" },
      data: { activeOrganizationId: "org-new" },
    });
  });

  it("does not provision for a returning Google user", async () => {
    root.user.findUnique.mockResolvedValue({ id: "user-old", email: "ari@example.com" });
    root.user.update.mockResolvedValue({ id: "user-old", email: "ari@example.com", name: "Ari" });

    const { result, user } = await signIn();

    expect(result).toBe(true);
    expect(user.id).toBe("user-old");
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(tx.organization.create).not.toHaveBeenCalled();
  });

  it("falls back to the returning-user path when a concurrent first sign-in wins", async () => {
    root.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "user-raced", email: "ari@example.com", password: null });
    root.$transaction.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    root.user.update.mockResolvedValue({ id: "user-raced", email: "ari@example.com", name: "Ari" });

    const { result, user } = await signIn();

    expect(result).toBe(true);
    expect(user.id).toBe("user-raced");
    expect(root.user.update).toHaveBeenCalledWith({
      where: { email: "ari@example.com" },
      data: { name: "Ari" },
    });
    expect(tx.organization.create).not.toHaveBeenCalled();
  });
});

describe("provisioning is idempotent and enforce still fails closed for existing users", () => {
  beforeEach(resetAll);
  afterEach(() => vi.unstubAllEnvs());

  it("a second provisioning call is a no-op", async () => {
    const client = tx as unknown as WorkspaceDatabase;
    const user = { name: "Ari", email: "ari@example.com" };

    const first = await provisionPersonalWorkspace("user-new", user, client);
    expect(first?.organizationId).toBe("org-new");
    expect(tx.organization.create).toHaveBeenCalledTimes(1);

    // The first call's membership is now visible to the next check.
    tx.membership.findFirst.mockResolvedValue({
      id: "membership-new",
      organizationId: "org-new",
      userId: "user-new",
      role: "OWNER",
    });

    const second = await provisionPersonalWorkspace("user-new", user, client);

    expect(second?.organizationId).toBe("org-new");
    expect(second?.role).toBe("OWNER");
    expect(tx.organization.create).toHaveBeenCalledTimes(1);
    expect(tx.membership.create).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it("takes the user row lock inside the transaction before the membership check", async () => {
    const order: string[] = [];
    const lockedTx = {
      ...mocks.delegates(),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        order.push(`lock:${strings.join("?")}:${values.join(",")}`);
        return [];
      }),
    };
    lockedTx.membership.findFirst.mockImplementation(async () => {
      order.push("check");
      return null;
    });
    lockedTx.organization.create.mockImplementation(async () => {
      order.push("create");
      return { id: "org-new", name: "Ari's Workspace" };
    });
    const client = {
      ...mocks.delegates(),
      $transaction: vi.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(lockedTx)),
    } as unknown as WorkspaceDatabase;

    await ensurePersonalWorkspace("user-new", { name: "Ari" }, client);

    expect(order).toEqual([
      'lock:SELECT 1 FROM "User" WHERE "id" = ? FOR NO KEY UPDATE:user-new',
      "check",
      "create",
    ]);
  });

  it("rolls back signup when no workspace can be provisioned", async () => {
    tx.organization.create.mockResolvedValue(undefined);

    await expect(
      createUserWithPersonalWorkspace(
        { name: "Ari", email: "ari@example.com", password: "x" },
        root as unknown as WorkspaceDatabase,
      ),
    ).rejects.toThrow(/could not be provisioned/);
  });

  it("compat lazy provisioning runs inside a transaction and re-checks membership", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "compat");
    root.user.findUnique.mockResolvedValue({
      id: "user-a",
      name: "Ari",
      email: "ari@example.com",
      activeOrganizationId: null,
    });
    root.membership.findFirst.mockResolvedValue(null);
    // Another request provisioned between the outer check and the transaction.
    tx.membership.findFirst.mockResolvedValue({
      id: "membership-x",
      organizationId: "org-x",
      userId: "user-a",
      role: "OWNER",
    });

    const context = await resolveWorkspaceContext("user-a", undefined, root as unknown as WorkspaceDatabase);

    expect(root.$transaction).toHaveBeenCalledTimes(1);
    expect(context?.organizationId).toBe("org-x");
    expect(tx.organization.create).not.toHaveBeenCalled();
  });

  it("an existing user without membership still resolves to null under enforce", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "enforce");
    root.user.findUnique.mockResolvedValue({
      id: "user-legacy",
      name: "Lama",
      email: "lama@example.com",
      activeOrganizationId: null,
    });
    root.membership.findFirst.mockResolvedValue(null);

    const context = await resolveWorkspaceContext("user-legacy", undefined, root as unknown as WorkspaceDatabase);

    expect(context).toBeNull();
    expect(root.$transaction).not.toHaveBeenCalled();
    expect(root.organization.create).not.toHaveBeenCalled();
    expect(tx.organization.create).not.toHaveBeenCalled();
  });
});
