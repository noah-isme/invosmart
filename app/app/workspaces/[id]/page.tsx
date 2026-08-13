import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { resolveWorkspaceContext, hasWorkspacePermission } from "@/lib/workspaces";
import { WorkspaceInvitationPanel } from "./WorkspaceInvitationPanel";

type WorkspaceDetailPageProps = { params: Promise<{ id: string }> };

export default async function WorkspaceDetailPage({ params }: WorkspaceDetailPageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/auth/login");

  const { id } = await params;
  const context = await resolveWorkspaceContext(session.user.id, id);
  if (!context || context.organizationId !== id || !hasWorkspacePermission(context.role, "read")) {
    notFound();
  }

  const [organization, members] = await Promise.all([
    db.organization.findUnique({ where: { id } }),
    db.membership.findMany({
      where: { organizationId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!organization) notFound();

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/app/workspaces" className="text-sm text-indigo-300 hover:text-indigo-200">← All workspaces</Link>
          <h1 className="mt-3 text-3xl font-semibold text-white">{organization.name}</h1>
          <p className="mt-2 text-sm text-white/70">Your role: {context.role}</p>
        </div>
        <span className="rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-wide text-white/70">
          {context.role}
        </span>
      </header>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium text-white">Members</h2>
            <p className="mt-1 text-sm text-white/60">Membership is checked server-side for every workspace request.</p>
          </div>
          {hasWorkspacePermission(context.role, "manage_members") ? (
            <span className="rounded-full bg-indigo-400/15 px-3 py-1 text-xs text-indigo-200">Member management enabled</span>
          ) : null}
        </div>
        <ul className="mt-5 divide-y divide-white/10">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">{member.user.name || member.user.email}</p>
                <p className="text-xs text-white/50">{member.user.email}</p>
              </div>
              <span className="text-xs text-white/60">{member.role}</span>
            </li>
          ))}
        </ul>
      </section>
      {hasWorkspacePermission(context.role, "manage_members") ? (
        <WorkspaceInvitationPanel organizationId={id} />
      ) : null}
    </section>
  );
}
