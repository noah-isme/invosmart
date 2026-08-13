import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ id: string; endpointId: string }> };
const enabledSchema = z.object({ enabled: z.boolean() });

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, endpointId } = await params;
  const context = await resolveWorkspaceContext(session.user.id, id);
  if (!context || context.organizationId !== id) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  if (!hasWorkspacePermission(context.role, "manage_workspace")) return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  const parsed = enabledSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const updated = await db.workspaceNotificationEndpoint.updateMany({ where: { id: endpointId, organizationId: id }, data: { enabled: parsed.data.enabled } });
  if (updated.count !== 1) return NextResponse.json({ error: "Notification endpoint not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, endpointId } = await params;
  const context = await resolveWorkspaceContext(session.user.id, id);
  if (!context || context.organizationId !== id) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  if (!hasWorkspacePermission(context.role, "manage_workspace")) return NextResponse.json({ error: "Workspace settings denied" }, { status: 403 });
  const deleted = await db.workspaceNotificationEndpoint.deleteMany({ where: { id: endpointId, organizationId: id } });
  if (deleted.count !== 1) return NextResponse.json({ error: "Notification endpoint not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
