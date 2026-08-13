import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import {
  hasWorkspacePermission,
  resolveWorkspaceContext,
} from "@/lib/workspaces";
import { createInvitationToken } from "@/lib/team/invitations";
import { logAuditEvent } from "@/lib/audit/auditLogger";

const invitationSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  role: z.enum(["ADMIN", "MEMBER", "VIEWER"]).default("MEMBER"),
});

type RouteContext = { params: Promise<{ id: string }> };

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Workspace not found" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "Workspace member management denied" }, { status: 403 });

const getContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  if (!hasWorkspacePermission(context.role, "manage_members")) return "forbidden" as const;
  return context;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id } = await params;
  const context = await getContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const invitations = await db.workspaceInvitation.findMany({
    where: { organizationId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ data: invitations });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id } = await params;
  const context = await getContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const parsed = invitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (context.role === "ADMIN" && parsed.data.role === "ADMIN") {
    return NextResponse.json({ error: "Only an owner can invite workspace administrators" }, { status: 403 });
  }

  const existingMember = await db.membership.findUnique({
    where: { organizationId_userId: { organizationId: id, userId: session.user.id } },
  });
  if (!existingMember) return notFound();

  const pending = await db.workspaceInvitation.findFirst({
    where: { organizationId: id, email: parsed.data.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (pending) return NextResponse.json({ error: "An active invitation already exists for this email" }, { status: 409 });

  const generated = createInvitationToken();
  const invitation = await db.workspaceInvitation.create({
    data: {
      organizationId: id,
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash: generated.tokenHash,
      expiresAt: generated.expiresAt,
      invitedById: session.user.id,
    },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });

  void logAuditEvent({
    tenantId: id,
    userId: session.user.id,
    action: "WORKSPACE_INVITATION_CREATE",
    entity: "WorkspaceInvitation",
    entityId: invitation.id,
    details: { email: invitation.email, role: invitation.role },
  });

  // The raw token is returned exactly once to the trusted caller. A delivery
  // adapter can use it to build the email link without persisting it.
  return NextResponse.json({ data: invitation, token: generated.token }, { status: 201 });
}
