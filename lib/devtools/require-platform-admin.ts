import type { Session } from "next-auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { isPlatformAdmin } from "@/lib/devtools/access";
import { authOptions } from "@/server/auth";

/** A session whose `user` (and therefore `user.id`) is known to exist. */
export type AdminSession = Session & { user: NonNullable<Session["user"]> };

/**
 * Page-level gate for platform-admin pages and layouts (server components).
 * Redirects anonymous visitors to login and non-admins to the app home.
 */
export async function requirePlatformAdminPage(): Promise<AdminSession> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  if (!isPlatformAdmin(session)) {
    redirect("/app");
  }

  return session as AdminSession;
}

/**
 * Gate for server actions. Server actions are publicly invocable endpoints,
 * so every platform-admin action must authorise itself.
 */
export async function assertPlatformAdminAction(): Promise<AdminSession> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id || !isPlatformAdmin(session)) {
    throw new Error("Forbidden");
  }

  return session as AdminSession;
}
