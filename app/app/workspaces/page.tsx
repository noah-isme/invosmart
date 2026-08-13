import Link from "next/link";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { WorkspaceSwitchButton } from "./WorkspaceSwitchButton";

export default async function WorkspacesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const [user, memberships] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id }, select: { activeOrganizationId: true } }),
    db.membership.findMany({
      where: { userId: session.user.id },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-indigo-300">Workspace</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Your workspaces</h1>
        <p className="mt-2 text-sm text-white/70">
          Choose the workspace whose invoices, clients, and team activity you want to manage.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {memberships.map((membership) => (
          <article
            key={membership.id}
            className={`rounded-2xl border p-5 ${membership.organizationId === user?.activeOrganizationId ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/10 bg-white/5"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-white">{membership.organization.name}</h2>
                <p className="mt-1 text-sm text-white/60">Role: {membership.role}</p>
              </div>
              {membership.organizationId === user?.activeOrganizationId ? (
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-200">Active</span>
              ) : null}
            </div>
            <Link
              href={`/app/workspaces/${membership.organizationId}`}
              className="mt-4 inline-flex rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-white/40 hover:text-white"
            >
              Manage workspace
            </Link>
            <WorkspaceSwitchButton organizationId={membership.organizationId} active={membership.organizationId === user?.activeOrganizationId} />
          </article>
        ))}
      </div>
      {memberships.length === 0 ? (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          Your personal workspace is being provisioned. Refresh this page once the migration has completed.
        </p>
      ) : null}
    </section>
  );
}
