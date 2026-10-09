// Provisioning core for personal workspaces. Deliberately free of `@/` aliases
// and of the shared Prisma client so it can be used by ts-node scripts
// (seed, backfill) as well as by the Next.js app via `lib/workspaces.ts`.
import type { WorkspaceRole } from "@prisma/client";

export type WorkspaceMembership = {
  id: string;
  organizationId: string;
  userId: string;
  role: WorkspaceRole;
  organization?: {
    id: string;
    name: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    fontFamily?: string | null;
    defaultCurrency?: string;
  } | null;
};

export type WorkspaceContext = {
  userId: string;
  organizationId: string | null;
  role: WorkspaceRole | "LEGACY";
  membership: WorkspaceMembership | null;
};

export type WorkspaceDatabase = {
  /**
   * Present on a real Prisma client. Optional because lightweight test doubles
   * (and pre-migration route mocks) do not implement it; callers fall back to
   * running without a transaction in that case.
   */
  $transaction?: <T>(fn: (tx: WorkspaceDatabase) => Promise<T>) => Promise<T>;
  /** Tagged-template raw query; optional for the same reason as `$transaction`. */
  $queryRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  user: {
    findUnique: (args: unknown) => Promise<{
      id?: string;
      name?: string | null;
      email?: string | null;
      activeOrganizationId?: string | null;
    } | null | undefined>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  membership: {
    findUnique: (args: unknown) => Promise<WorkspaceMembership | null | undefined>;
    findFirst: (args: unknown) => Promise<WorkspaceMembership | null | undefined>;
    create: (args: unknown) => Promise<WorkspaceMembership | null | undefined>;
  };
  organization: {
    create: (args: unknown) => Promise<{
      id: string;
      name: string;
      logoUrl?: string | null;
      primaryColor?: string | null;
      fontFamily?: string | null;
      defaultCurrency?: string;
    } | null | undefined>;
  };
};

export const membershipSelect = {
  id: true,
  organizationId: true,
  userId: true,
  role: true,
  organization: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      fontFamily: true,
      defaultCurrency: true,
    },
  },
} as const;

export const contextFromMembership = (
  userId: string,
  membership: WorkspaceMembership,
): WorkspaceContext => ({
  userId,
  organizationId: membership.organizationId,
  role: membership.role,
  membership,
});

/**
 * Create the personal workspace (Organization + OWNER Membership) for a user
 * and make it their active workspace.
 *
 * Idempotent: if the user already has any membership this is a no-op and the
 * existing context is returned, so signup and the compat-mode lazy path can
 * both call it without creating a second personal workspace.
 *
 * Callers should pass a transaction client so the check and the writes (and,
 * at signup, the user row itself) commit atomically.
 *
 * Race safety: the first statement takes a `FOR NO KEY UPDATE` row lock on
 * the user. Concurrent provisioning for the same user (signup vs. compat lazy
 * path, or two first requests) therefore serialises, and the loser's
 * membership check below sees the winner's committed workspace and returns it
 * unchanged. `NO KEY UPDATE` (not `FOR UPDATE`) is deliberate so inserts that
 * reference the user through a foreign key (Membership, etc.) are not blocked.
 * The lock only holds for the surrounding transaction, so this must run on a
 * transaction client; on a bare client (or a test double without `$queryRaw`)
 * it degrades to a plain check-then-create with a small residual race window.
 * There is still no database constraint identifying a personal workspace, so
 * code paths that create workspaces without taking this lock (for example
 * `POST /api/workspaces`) are not serialised against it; those create
 * deliberate additional workspaces and do not count as double-provisioning.
 */
export const provisionPersonalWorkspace = async (
  userId: string,
  user: { name?: string | null; email?: string | null } | null | undefined,
  client: WorkspaceDatabase,
): Promise<WorkspaceContext | null> => {
  if (client.$queryRaw) {
    await client.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
  }

  const existing = await client.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: membershipSelect,
  });

  if (existing) {
    return contextFromMembership(userId, existing);
  }

  const name =
    user?.name?.trim() ||
    user?.email?.split("@")[0]?.trim() ||
    "Personal Workspace";

  const organization = await client.organization.create({
    data: {
      name: `${name}'s Workspace`,
      defaultCurrency: "IDR",
    },
  });

  // An undefined result is how the lightweight Prisma test double signals a
  // delegate that was not configured. Fall back to legacy scoping in that
  // environment; a real Prisma client returns a row or throws.
  if (!organization) {
    return null;
  }

  const membership = await client.membership.create({
    data: {
      organizationId: organization.id,
      userId,
      role: "OWNER",
    },
    include: { organization: true },
  });

  await client.user.update({
    where: { id: userId },
    data: { activeOrganizationId: organization.id },
  });

  return {
    userId,
    organizationId: organization.id,
    role: "OWNER",
    membership: membership ?? {
      id: `owner:${userId}:${organization.id}`,
      organizationId: organization.id,
      userId,
      role: "OWNER" as WorkspaceRole,
      organization,
    },
  };
};

export const inTransaction = <T>(
  client: WorkspaceDatabase,
  fn: (tx: WorkspaceDatabase) => Promise<T>,
): Promise<T> => (client.$transaction ? client.$transaction(fn) : fn(client));

/** Provision inside its own transaction so the row lock and the writes commit together. */
export const ensurePersonalWorkspace = (
  userId: string,
  user: { name?: string | null; email?: string | null } | null | undefined,
  client: WorkspaceDatabase,
): Promise<WorkspaceContext | null> =>
  inTransaction(client, (tx) => provisionPersonalWorkspace(userId, user, tx));

/** Prisma unique-constraint violation (P2002), without importing the runtime error class. */
export const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "P2002";

export type NewUserData = {
  name: string;
  email: string;
  password: string | null;
};

/**
 * Create a user together with their personal workspace, OWNER membership and
 * active-workspace hint in a single transaction. Used by credentials signup
 * and first-time OAuth sign-in so both behave identically in compat and
 * enforce modes. Any failure rolls back the user row as well; a unique-email
 * violation surfaces as a P2002 error (see isUniqueConstraintError).
 */
export const createUserWithPersonalWorkspace = async <
  U extends { id: string; name?: string | null; email?: string | null },
>(
  data: NewUserData,
  client: WorkspaceDatabase,
): Promise<U> =>
  inTransaction(client, async (tx) => {
    const created = (await tx.user.create({ data })) as U;
    const context = await provisionPersonalWorkspace(created.id, created, tx);
    if (!context) {
      // Never leave a user behind without a workspace: roll the user back too.
      throw new Error("Personal workspace could not be provisioned for the new user.");
    }
    return created;
  });

