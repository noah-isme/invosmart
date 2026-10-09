// Backfill for users that have no workspace membership at all (for example
// accounts registered under WORKSPACE_AUTH_MODE=enforce before signup
// provisioning existed). Idempotent and safe to re-run: it only selects users
// without any Membership and provisions each one in its own transaction via
// the same code signup uses, which re-checks membership under a row lock.
//
// Do NOT re-run the SQL block in the 20260813120000_workspace_rbac_foundation
// migration for this purpose; it is keyed on every user and is not safe for
// users that already have an application-provisioned workspace.
import { ensurePersonalWorkspace, type WorkspaceDatabase } from "./workspace-provisioning";

export type BackfillUser = { id: string; name?: string | null; email?: string | null };

export type BackfillClient = WorkspaceDatabase & {
  user: WorkspaceDatabase["user"] & {
    findMany: (args: unknown) => Promise<BackfillUser[]>;
  };
};

export type BackfillResult = {
  apply: boolean;
  candidateIds: string[];
  provisionedIds: string[];
  failed: { id: string; error: string }[];
};

/** Users with no Membership: equivalent to WHERE NOT EXISTS (... "Membership" m WHERE m."userId" = u."id"). */
export const findUsersWithoutMembership = (client: BackfillClient) =>
  client.user.findMany({
    where: { memberships: { none: {} } },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  });

export const backfillPersonalWorkspaces = async (
  client: BackfillClient,
  options: { apply: boolean },
): Promise<BackfillResult> => {
  const users = await findUsersWithoutMembership(client);
  const result: BackfillResult = {
    apply: options.apply,
    candidateIds: users.map((user) => user.id),
    provisionedIds: [],
    failed: [],
  };

  if (!options.apply) {
    return result;
  }

  for (const user of users) {
    try {
      // Own transaction per user: one failure never rolls back the others, and
      // the membership re-check inside makes a concurrent signup/lazy
      // provision (or a re-run) a no-op instead of a second workspace.
      const context = await ensurePersonalWorkspace(user.id, user, client);
      if (context) {
        result.provisionedIds.push(user.id);
      } else {
        result.failed.push({ id: user.id, error: "provisioning returned no workspace" });
      }
    } catch (error) {
      result.failed.push({
        id: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
};

/** host:port/database of a connection URL, never including credentials. Null if unparseable. */
export const describeDatabaseTarget = (url: string | undefined): string | null => {
  if (!url?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(url.trim());
    if (!parsed.hostname) {
      return null;
    }
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${database}`;
  } catch {
    return null;
  }
};
