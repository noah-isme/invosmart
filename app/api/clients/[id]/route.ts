import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ClientUpdateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import {
  canReadWorkspace,
  canWriteWorkspace,
  resolveWorkspaceContextForRequest,
  workspaceData,
  workspaceScope,
} from "@/lib/workspaces";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "Client not found" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  const limited = rateLimit(request, "client_id");
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) return forbidden();
  const scope = workspaceScope(workspace);

  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, ...scope },
    include: {
      invoices: {
        where: scope,
        orderBy: { createdAt: 'desc' },
        take: 5
      }
    }
  });

  if (!client) return notFound();

  return NextResponse.json({ data: client });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  const limited = rateLimit(request, "client_id");
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canWriteWorkspace(workspace)) return forbidden();
  const scope = workspaceScope(workspace);

  const { id } = await params;

  const json = await request.json();
  const parsed = ClientUpdateSchema.safeParse({ ...json, id });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await db.client.findFirst({ where: { id, ...scope } });
  if (!existing) return notFound();

  // If email is provided, verify uniqueness for this user
  if (parsed.data.email && parsed.data.email !== existing.email) {
    const existingEmail = await db.client.findFirst({
      where: { ...scope, email: parsed.data.email },
    });
    if (existingEmail) {
      return NextResponse.json({ error: "A client with this email already exists." }, { status: 400 });
    }
  }

  const client = await db.client.update({
    where: { id },
    data: { ...parsed.data, ...workspaceData(workspace) }
  });

  void logAuditEvent({
    tenantId: workspace.organizationId,
    userId: session.user.id,
    action: AuditAction.CLIENT_UPDATE,
    entity: AuditEntity.CLIENT,
    entityId: client.id,
    details: { name: client.name, email: client.email },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: client });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canWriteWorkspace(workspace)) return forbidden();
  const scope = workspaceScope(workspace);

  const { id } = await params;

  const client = await db.client.findFirst({
    where: { id, ...scope },
    include: {
      _count: { select: { invoices: true } }
    }
  });

  if (!client) return notFound();

  if (client._count.invoices > 0) {
    return NextResponse.json({ error: "Cannot delete client with existing invoices." }, { status: 400 });
  }

  await db.client.delete({ where: { id } });

  void logAuditEvent({
    tenantId: workspace.organizationId,
    userId: session.user.id,
    action: AuditAction.CLIENT_DELETE,
    entity: AuditEntity.CLIENT,
    entityId: id,
    details: { name: client.name },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ success: true });
}
