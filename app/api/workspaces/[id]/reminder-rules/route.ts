import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ id: string }> };
const reminderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  offsetDays: z.number().int().min(-365).max(365),
  channels: z.array(z.enum(["EMAIL", "SLACK"])).min(1).max(2),
  enabled: z.boolean().optional().default(true),
});

const loadContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_workspace") ? context : "forbidden" as const;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const context = await resolveWorkspaceContext(session.user.id, id);
  if (!context || context.organizationId !== id) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const rules = await db.invoiceReminderRule.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ data: rules });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const context = await loadContext(session.user.id, id);
  if (context === "forbidden") return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  if (!context) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  const parsed = reminderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const rule = await db.invoiceReminderRule.create({
    data: { organizationId: id, ...parsed.data },
  });
  return NextResponse.json({ data: rule }, { status: 201 });
}
