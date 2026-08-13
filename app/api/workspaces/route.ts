import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { resolveWorkspaceContext } from "@/lib/workspaces";
import { logAuditEvent } from "@/lib/audit/auditLogger";

const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  defaultCurrency: z.string().trim().length(3).default("IDR"),
});

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const memberships = await db.membership.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });

  // Provisioning is idempotent in the resolver and keeps old accounts usable
  // when the additive migration was deployed without a seed pass.
  if (memberships.length === 0) {
    await resolveWorkspaceContext(userId);
    const provisioned = await db.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    const user = await db.user.findUnique({ where: { id: userId }, select: { activeOrganizationId: true } });
    return NextResponse.json({
      data: provisioned.map((membership) => ({
        ...membership,
        active: membership.organizationId === user?.activeOrganizationId,
      })),
    });
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { activeOrganizationId: true } });
  return NextResponse.json({
    data: memberships.map((membership) => ({
      ...membership,
      active: membership.organizationId === user?.activeOrganizationId,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const parsed = workspaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: parsed.data });
    const membership = await tx.membership.create({
      data: { organizationId: organization.id, userId, role: "OWNER" },
      include: { organization: true },
    });
    await tx.user.update({ where: { id: userId }, data: { activeOrganizationId: organization.id } });
    return membership;
  });

  void logAuditEvent({
    tenantId: created.organizationId,
    userId,
    action: "WORKSPACE_CREATE",
    entity: "Organization",
    entityId: created.organizationId,
    details: { name: created.organization.name },
  });

  return NextResponse.json({ data: created }, { status: 201 });
}
