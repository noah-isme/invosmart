import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { hashInvitationToken, verifyInvitationToken } from "@/lib/team/invitations";
import { logAuditEvent } from "@/lib/audit/auditLogger";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const userEmail = session.user.email;

  const { token } = await params;
  const tokenHash = hashInvitationToken(token);
  const invitation = await db.workspaceInvitation.findUnique({
    where: { tokenHash },
  });
  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    return NextResponse.json({ error: "Invitation email does not match the signed-in account" }, { status: 403 });
  }

  const verification = verifyInvitationToken(token, invitation, { now: new Date() });
  if (!verification.ok) {
    return NextResponse.json({ error: `Invitation is ${verification.reason}` }, { status: 410 });
  }

  try {
    const membership = await db.$transaction(async (tx) => {
      const claimed = await tx.workspaceInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("INVITATION_ALREADY_CLAIMED");

      return tx.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
        create: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
        },
        update: { role: invitation.role },
        include: { organization: true },
      });
    });

    void logAuditEvent({
      tenantId: invitation.organizationId,
      userId,
      action: "WORKSPACE_INVITATION_ACCEPT",
      entity: "WorkspaceInvitation",
      entityId: invitation.id,
    });

    return NextResponse.json({ data: membership });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_ALREADY_CLAIMED") {
      return NextResponse.json({ error: "Invitation has already been claimed" }, { status: 409 });
    }
    console.error("[WorkspaceInvitation] Failed to accept invitation:", error);
    return NextResponse.json({ error: "Unable to accept invitation" }, { status: 500 });
  }
}
