import type { Session } from "next-auth";

/**
 * Platform-admin access (devtools, global admin APIs and admin pages).
 *
 * Identity model: a platform admin is a user whose database id (the NextAuth
 * JWT `sub`, exposed as `session.user.id`) is listed in `ADMIN_USER_IDS`.
 * Email addresses are deliberately NOT an identity here: credentials
 * registration does not verify email ownership, so anyone could register an
 * address that is listed in an allowlist. `ADMIN_EMAILS` is therefore ignored
 * (deprecated) and only triggers an operator warning.
 *
 * This is separate from workspace RBAC (OWNER/ADMIN/MEMBER/VIEWER), which
 * governs a single workspace and must never be used to gate global resources.
 */

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const getPlatformAdminUserIds = (): ReadonlySet<string> =>
  new Set(splitList(process.env.ADMIN_USER_IDS));

const hasLegacyAdminEmails = () =>
  splitList(process.env.ADMIN_EMAILS).length > 0 ||
  splitList(process.env.NEXT_PUBLIC_ADMIN_EMAILS).length > 0;

let warnedLegacyEmails = false;
let warnedNoAdmins = false;

/**
 * Emits operator-facing warnings about the admin configuration. Safe to call
 * repeatedly; each warning is logged once per process. Never logs addresses
 * or ids.
 */
export const warnAboutAdminConfig = () => {
  const noAdmins = getPlatformAdminUserIds().size === 0;

  if (hasLegacyAdminEmails() && !warnedLegacyEmails) {
    warnedLegacyEmails = true;
    console.warn(
      noAdmins
        ? "[security] ADMIN_EMAILS is deprecated and no longer grants platform-admin access, and ADMIN_USER_IDS is empty: nobody can reach admin/devtools routes. Set ADMIN_USER_IDS to a comma-separated list of User ids."
        : "[security] ADMIN_EMAILS is deprecated and ignored. Platform-admin access is granted only to ids listed in ADMIN_USER_IDS; remove ADMIN_EMAILS.",
    );
  }

  if (noAdmins && !warnedNoAdmins && process.env.NODE_ENV === "production") {
    warnedNoAdmins = true;
    console.warn(
      "[security] ADMIN_USER_IDS is empty: platform-admin and devtools routes are denied to everyone.",
    );
  }
};

export const isPlatformAdmin = (session: Session | null | undefined) => {
  // Local development convenience only. `NODE_ENV=test` and every deployed
  // environment go through the allowlist.
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const userId = session?.user?.id;
  if (!userId) return false;

  const adminIds = getPlatformAdminUserIds();
  if (adminIds.size === 0) {
    warnAboutAdminConfig();
    return false;
  }

  return adminIds.has(userId);
};

export const getPerfToolsSampleRate = () => {
  const value = process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE ?? "0.2";
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return 0.2;
  }

  if (parsed <= 0) return 0;
  if (parsed >= 1) return 1;

  return parsed;
};

