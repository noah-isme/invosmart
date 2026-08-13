import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit/auditLogger";

const switchSchema = z.object({ organizationId: z.string().trim().min(1) });

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = switchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const membership = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId: parsed.data.organizationId, userId } },
    include: { organization: true },
  });
  if (!membership) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  await db.user.update({ where: { id: userId }, data: { activeOrganizationId: membership.organizationId } });
  void logAuditEvent({
    tenantId: membership.organizationId,
    userId,
    action: "WORKSPACE_SWITCH",
    entity: "Organization",
    entityId: membership.organizationId,
  });

  return NextResponse.json({ data: { organizationId: membership.organizationId, role: membership.role } });
}
