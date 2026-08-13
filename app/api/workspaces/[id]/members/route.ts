import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { resolveWorkspaceContext, hasWorkspacePermission } from "@/lib/workspaces";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const context = await resolveWorkspaceContext(userId, id);
  if (!context || context.organizationId !== id || !hasWorkspacePermission(context.role, "read")) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const members = await db.membership.findMany({
    where: { organizationId: id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data: members });
}
