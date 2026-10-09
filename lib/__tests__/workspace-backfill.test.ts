import { describe, expect, it, vi } from "vitest";

import {
  backfillPersonalWorkspaces,
  describeDatabaseTarget,
  type BackfillClient,
} from "@/lib/workspace-backfill";

type FakeUser = { id: string; name: string; email: string; activeOrganizationId: string | null };

/** Small stateful in-memory stand-in for the Prisma delegates the backfill touches. */
const fakeDatabase = (users: FakeUser[], memberships: { userId: string; organizationId: string }[]) => {
  let orgSeq = 0;
  const db = {
    users,
    memberships,
    organizations: [] as { id: string; name: string }[],
    user: {
      findMany: vi.fn(async () =>
        users.filter((u) => !memberships.some((m) => m.userId === u.id)),
      ),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
        Object.assign(users.find((u) => u.id === where.id)!, data);
      }),
    },
    membership: {
      findUnique: vi.fn(),
      findFirst: vi.fn(async ({ where }: { where: { userId: string } }) => {
        const found = memberships.find((m) => m.userId === where.userId);
        return found ? { id: `m-${found.userId}`, role: "OWNER", ...found } : null;
      }),
      create: vi.fn(async ({ data }: { data: { organizationId: string; userId: string } }) => {
        memberships.push({ userId: data.userId, organizationId: data.organizationId });
        return { id: `m-${data.userId}`, role: "OWNER", ...data };
      }),
    },
    organization: {
      create: vi.fn(async ({ data }: { data: { name: string } }) => {
        const org = { id: `org-${++orgSeq}`, name: data.name };
        db.organizations.push(org);
        return org;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db;
};

const seedUsers = (): FakeUser[] => [
  { id: "stranded-1", name: "Ari", email: "ari@example.com", activeOrganizationId: null },
  { id: "has-ws", name: "Budi", email: "budi@example.com", activeOrganizationId: "org-existing" },
  { id: "stranded-2", name: "", email: "cici@example.com", activeOrganizationId: null },
];

const asClient = (db: ReturnType<typeof fakeDatabase>) => db as unknown as BackfillClient;

describe("backfillPersonalWorkspaces", () => {
  it("dry run reports candidates and writes nothing", async () => {
    const db = fakeDatabase(seedUsers(), [{ userId: "has-ws", organizationId: "org-existing" }]);

    const result = await backfillPersonalWorkspaces(asClient(db), { apply: false });

    expect(result.candidateIds).toEqual(["stranded-1", "stranded-2"]);
    expect(result.provisionedIds).toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.organization.create).not.toHaveBeenCalled();
    expect(db.membership.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("selects users with no membership only and provisions each in its own transaction", async () => {
    const db = fakeDatabase(seedUsers(), [{ userId: "has-ws", organizationId: "org-existing" }]);

    const result = await backfillPersonalWorkspaces(asClient(db), { apply: true });

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { memberships: { none: {} } } }),
    );
    expect(result.provisionedIds).toEqual(["stranded-1", "stranded-2"]);
    expect(result.failed).toEqual([]);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.organization.create).toHaveBeenCalledTimes(2);
    expect(db.membership.create).toHaveBeenCalledTimes(2);
    // The user that already had a workspace is untouched.
    expect(db.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "has-ws" } }),
    );
    expect(db.users.find((u) => u.id === "has-ws")!.activeOrganizationId).toBe("org-existing");
    expect(db.users.find((u) => u.id === "stranded-1")!.activeOrganizationId).toBe("org-1");
  });

  it("a second run is a no-op", async () => {
    const db = fakeDatabase(seedUsers(), [{ userId: "has-ws", organizationId: "org-existing" }]);

    await backfillPersonalWorkspaces(asClient(db), { apply: true });
    db.$transaction.mockClear();
    db.organization.create.mockClear();
    db.membership.create.mockClear();

    const second = await backfillPersonalWorkspaces(asClient(db), { apply: true });

    expect(second.candidateIds).toEqual([]);
    expect(second.provisionedIds).toEqual([]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.organization.create).not.toHaveBeenCalled();
    expect(db.membership.create).not.toHaveBeenCalled();
  });

  it("does not create a second workspace for a user provisioned between selection and write", async () => {
    const db = fakeDatabase(seedUsers(), []);
    // Signup/lazy provisioning wins the race for stranded-1 after the candidate list was read.
    db.user.findMany.mockImplementationOnce(async () => {
      const snapshot = db.users.filter((u) => u.id.startsWith("stranded"));
      db.memberships.push({ userId: "stranded-1", organizationId: "org-race" });
      return snapshot;
    });

    const result = await backfillPersonalWorkspaces(asClient(db), { apply: true });

    expect(db.organization.create).toHaveBeenCalledTimes(1);
    expect(db.memberships.filter((m) => m.userId === "stranded-1")).toHaveLength(1);
    expect(result.failed).toEqual([]);
  });

  it("keeps going and reports failures for individual users", async () => {
    const db = fakeDatabase(seedUsers(), [{ userId: "has-ws", organizationId: "org-existing" }]);
    db.organization.create.mockRejectedValueOnce(new Error("boom"));

    const result = await backfillPersonalWorkspaces(asClient(db), { apply: true });

    expect(result.failed).toEqual([{ id: "stranded-1", error: "boom" }]);
    expect(result.provisionedIds).toEqual(["stranded-2"]);
  });
});

describe("describeDatabaseTarget", () => {
  it("prints host, port and database without credentials", () => {
    expect(describeDatabaseTarget("postgresql://user:secret@db.example.com:5432/invosmart?sslmode=require")).toBe(
      "db.example.com:5432/invosmart",
    );
  });

  it("returns null for missing or invalid URLs so the script refuses to run", () => {
    expect(describeDatabaseTarget(undefined)).toBeNull();
    expect(describeDatabaseTarget("   ")).toBeNull();
    expect(describeDatabaseTarget("not a url")).toBeNull();
  });
});
