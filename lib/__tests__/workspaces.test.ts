import { describe, expect, it, vi } from "vitest";

import {
  canReadWorkspace,
  canWriteWorkspace,
  getWorkspaceAuthMode,
  hasWorkspacePermission,
  resolveWorkspaceContext,
  type WorkspaceDatabase,
} from "@/lib/workspaces";

const membership = (role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") => ({
  id: "membership-1",
  organizationId: "org-a",
  userId: "user-a",
  role,
  organization: { id: "org-a", name: "Acme" },
});

const database = (overrides: Partial<WorkspaceDatabase> = {}) =>
  ({
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-a",
        name: "Ari",
        email: "ari@example.com",
        activeOrganizationId: null,
      }),
      update: vi.fn(),
    },
    membership: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    organization: {
      create: vi.fn().mockResolvedValue({ id: "org-personal", name: "Ari's Workspace" }),
    },
    ...overrides,
  }) as WorkspaceDatabase;

describe("workspace RBAC", () => {
  it("keeps the four-role permission matrix explicit", () => {
    expect(hasWorkspacePermission("OWNER", "manage_workspace")).toBe(true);
    expect(hasWorkspacePermission("ADMIN", "manage_members")).toBe(true);
    expect(hasWorkspacePermission("MEMBER", "write")).toBe(true);
    expect(hasWorkspacePermission("VIEWER", "write")).toBe(false);
    expect(hasWorkspacePermission("VIEWER", "read")).toBe(true);
  });

  it("resolves a requested workspace from a database membership", async () => {
    const client = database({
      membership: {
        findUnique: vi.fn().mockResolvedValue(membership("MEMBER")),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    });

    const context = await resolveWorkspaceContext("user-a", "org-a", client);

    expect(context).toMatchObject({
      userId: "user-a",
      organizationId: "org-a",
      role: "MEMBER",
    });
    expect(context && canReadWorkspace(context)).toBe(true);
    expect(context && canWriteWorkspace(context)).toBe(true);
    expect(client.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_userId: { organizationId: "org-a", userId: "user-a" } },
      }),
    );
  });

  it("denies a requested workspace when membership is absent", async () => {
    const client = database();

    await expect(resolveWorkspaceContext("user-a", "org-other", client)).resolves.toBeNull();
  });

  it("provisions a personal owner workspace when a real user has no membership", async () => {
    const membershipCreate = vi.fn().mockResolvedValue(null);
    const client = database({
      membership: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: membershipCreate,
      },
    });

    const context = await resolveWorkspaceContext("user-a", undefined, client);

    expect(context).toMatchObject({ organizationId: "org-personal", role: "OWNER" });
    expect(membershipCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { organizationId: "org-personal", userId: "user-a", role: "OWNER" },
      }),
    );
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "user-a" },
      data: { activeOrganizationId: "org-personal" },
    });
  });

  it("fails closed in enforce mode when membership backfill is incomplete", async () => {
    vi.stubEnv("WORKSPACE_AUTH_MODE", "enforce");
    try {
      expect(getWorkspaceAuthMode()).toBe("enforce");
      await expect(resolveWorkspaceContext("user-a", undefined, database())).resolves.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
