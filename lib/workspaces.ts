import type { NextRequest } from "next/server";

import { db } from "@/lib/db";

import {
  contextFromMembership,
  createUserWithPersonalWorkspace as createUserWithPersonalWorkspaceIn,
  ensurePersonalWorkspace,
  membershipSelect,
  type NewUserData,
  type WorkspaceContext,
  type WorkspaceDatabase,
} from "@/lib/workspace-provisioning";

import type { WorkspaceRole } from "@prisma/client";

export {
  isUniqueConstraintError,
  provisionPersonalWorkspace,
  type NewUserData,
  type WorkspaceContext,
  type WorkspaceDatabase,
  type WorkspaceMembership,
} from "@/lib/workspace-provisioning";

export type WorkspacePermission = "read" | "write" | "manage_members" | "manage_workspace";

export type WorkspaceAuthMode = "compat" | "enforce";

/**
 * Compatibility is the default so older deployments can roll out the
 * additive workspace migration safely. Staging/production can switch to
 * `enforce` after backfill rehearsal; unresolved membership then fails closed
 * instead of silently falling back to user-owned rows.
 */
export const getWorkspaceAuthMode = (): WorkspaceAuthMode =>
  process.env.WORKSPACE_AUTH_MODE?.trim().toLowerCase() === "enforce" ? "enforce" : "compat";

const legacyFallback = (userId: string): WorkspaceContext | null =>
  getWorkspaceAuthMode() === "enforce" ? null : legacyContext(userId);

const workspaceDb = db as unknown as WorkspaceDatabase;

/** See `createUserWithPersonalWorkspace` in lib/workspace-provisioning.ts; defaults to the app client. */
export const createUserWithPersonalWorkspace = <
  U extends { id: string; name?: string | null; email?: string | null },
>(
  data: NewUserData,
  client: WorkspaceDatabase = workspaceDb,
): Promise<U> => createUserWithPersonalWorkspaceIn<U>(data, client);

const rolePermissions: Record<WorkspaceRole | "LEGACY", readonly WorkspacePermission[]> = {
  OWNER: ["read", "write", "manage_members", "manage_workspace"],
  ADMIN: ["read", "write", "manage_members", "manage_workspace"],
  MEMBER: ["read", "write"],
  VIEWER: ["read"],
  // Existing user-owned rows are treated as owned by their user until the
  // workspace backfill is present. This keeps old deployments usable while
  // never granting a user access to another user's legacy rows.
  LEGACY: ["read", "write", "manage_members", "manage_workspace"],
};

export const hasWorkspacePermission = (
  role: WorkspaceRole | "LEGACY",
  permission: WorkspacePermission,
) => rolePermissions[role].includes(permission);

export const canReadWorkspace = (context: WorkspaceContext) =>
  hasWorkspacePermission(context.role, "read");

export const canWriteWorkspace = (context: WorkspaceContext) =>
  hasWorkspacePermission(context.role, "write");

const legacyContext = (userId: string): WorkspaceContext => ({
  userId,
  organizationId: null,
  role: "LEGACY",
  membership: null,
});

const membershipWhere = (organizationId: string, userId: string) => ({
  organizationId_userId: { organizationId, userId },
});

/**
 * Resolve a workspace exclusively from database membership.
 *
 * `requestedOrganizationId` is only a lookup hint. It is never trusted as an
 * authorization claim: a user without a matching Membership gets null.
 */
export const resolveWorkspaceContext = async (
  userId: string,
  requestedOrganizationId?: string | null,
  client: WorkspaceDatabase = workspaceDb,
): Promise<WorkspaceContext | null> => {
  if (!userId) {
    return null;
  }

  // Lightweight route doubles used by legacy tests and pre-migration
  // deployments may not expose the additive delegates yet. Preserve the
  // existing user-owned contract in that compatibility window.
  if (!client.user || !client.membership || !client.organization) {
    return legacyFallback(userId);
  }

  if (requestedOrganizationId) {
    const membership = await client.membership.findUnique({
      where: membershipWhere(requestedOrganizationId, userId),
      select: membershipSelect,
    });

    if (membership === undefined) {
      return legacyFallback(userId);
    }

    return membership ? contextFromMembership(userId, membership) : null;
  }

  const user = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, activeOrganizationId: true },
  });

  // Preserve compatibility with existing route unit tests and pre-workspace
  // deployments where the user delegate is not yet backed by these columns.
  if (user === undefined) {
    return legacyFallback(userId);
  }

  if (!user) {
    return legacyFallback(userId);
  }

  if (user?.activeOrganizationId) {
    const activeMembership = await client.membership.findUnique({
      where: membershipWhere(user.activeOrganizationId, userId),
      select: membershipSelect,
    });

    if (activeMembership) {
      return contextFromMembership(userId, activeMembership);
    }

    if (activeMembership === undefined) {
      return legacyFallback(userId);
    }
  }

  const membership = await client.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: membershipSelect,
  });

  if (membership) {
    return contextFromMembership(userId, membership);
  }

  if (membership === undefined) {
    return legacyFallback(userId);
  }

  if (getWorkspaceAuthMode() === "enforce") {
    return null;
  }

  const provisioned = await ensurePersonalWorkspace(userId, user, client);
  return provisioned ?? legacyContext(userId);
};

export const getRequestedOrganizationId = (request: NextRequest) => {
  const queryValue = request.nextUrl?.searchParams?.get("organizationId");
  if (queryValue) {
    return queryValue;
  }

  return request.headers.get("x-organization-id");
};

export const resolveWorkspaceContextForRequest = async (
  request: NextRequest,
  session: { user?: { id?: string | null } } | null | undefined,
  client: WorkspaceDatabase = workspaceDb,
) => {
  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }

  return resolveWorkspaceContext(userId, getRequestedOrganizationId(request), client);
};

/**
 * Build the data filter used by the business resources covered by the first
 * tenancy rollout. Never merge a client-provided organizationId into this
 * object; the value must come from resolveWorkspaceContext above.
 */
export const workspaceScope = (context: WorkspaceContext) =>
  context.organizationId
    ? { organizationId: context.organizationId }
    : { userId: context.userId };

export const workspaceData = (context: WorkspaceContext) =>
  context.organizationId ? { organizationId: context.organizationId } : {};
