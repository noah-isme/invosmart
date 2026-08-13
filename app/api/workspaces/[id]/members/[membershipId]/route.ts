import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";
import { logAuditEvent } from "@/lib/audit/auditLogger";

type RouteContext = { params: Promise<{ id: string; membershipId: string }> };
const roleSchema = z.object({ role: z.enum(["ADMIN", "MEMBER", "VIEWER"]) });

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Membership not found" }, { status: 404 });

const loadAdminContext = async (organizationId: string, userId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_members") ? context : "forbidden" as const;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id, membershipId } = await params;
  const context = await loadAdminContext(id, session.user.id);
  if (context === "forbidden") return NextResponse.json({ error: "Member management denied" }, { status: 403 });
  if (!context) return notFound();

  const parsed = roleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const target = await db.membership.findFirst({ where: { id: membershipId, organizationId: id } });
  if (!target) return notFound();
  if (target.role === "OWNER" || (context.role === "ADMIN" && parsed.data.role === "ADMIN")) {
    return NextResponse.json({ error: "Owner membership requires owner-only management" }, { status: 403 });
  }

  const updated = await db.membership.update({ where: { id: membershipId }, data: { role: parsed.data.role } });
  void logAuditEvent({ tenantId: id, userId: session.user.id, action: "WORKSPACE_MEMBER_ROLE_UPDATE", entity: "Membership", entityId: membershipId, details: { role: parsed.data.role } });
  return NextResponse.json({ data: updated });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id, membershipId } = await params;
  const context = await loadAdminContext(id, session.user.id);
  if (context === "forbidden") return NextResponse.json({ error: "Member management denied" }, { status: 403 });
  if (!context) return notFound();

  const target = await db.membership.findFirst({ where: { id: membershipId, organizationId: id } });
  if (!target) return notFound();
  if (target.role === "OWNER") return NextResponse.json({ error: "The owner cannot be removed" }, { status: 409 });

  await db.membership.delete({ where: { id: membershipId } });
  void logAuditEvent({ tenantId: id, userId: session.user.id, action: "WORKSPACE_MEMBER_REMOVE", entity: "Membership", entityId: membershipId });
  return NextResponse.json({ success: true });
}
