import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ id: string; ruleId: string }> };
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  offsetDays: z.number().int().min(-365).max(365).optional(),
  channels: z.array(z.enum(["EMAIL", "SLACK"])).min(1).max(2).optional(),
  enabled: z.boolean().optional(),
});

const getContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_workspace") ? context : "forbidden" as const;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ruleId } = await params;
  const context = await getContext(session.user.id, id);
  if (context === "forbidden") return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  if (!context) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const updated = await db.invoiceReminderRule.updateMany({ where: { id: ruleId, organizationId: id }, data: parsed.data });
  if (updated.count !== 1) return NextResponse.json({ error: "Reminder rule not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, ruleId } = await params;
  const context = await getContext(session.user.id, id);
  if (context === "forbidden") return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  if (!context) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const deleted = await db.invoiceReminderRule.deleteMany({ where: { id: ruleId, organizationId: id } });
  if (deleted.count !== 1) return NextResponse.json({ error: "Reminder rule not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
