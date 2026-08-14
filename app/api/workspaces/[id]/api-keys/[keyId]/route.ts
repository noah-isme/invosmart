import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { API_KEY_SCOPES } from "@/lib/api-keys";
import { getClientIp, logAuditEvent } from "@/lib/audit/auditLogger";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ id: string; keyId: string }> };

const scopeSchema = z.enum(API_KEY_SCOPES);
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    scopes: z.array(scopeSchema).min(1).max(API_KEY_SCOPES.length).optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    revoked: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scopes && new Set(value.scopes).size !== value.scopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scopes"], message: "Scopes must be unique" });
    }
    if (value.expiresAt && value.expiresAt.getTime() <= Date.now()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiration must be in the future" });
    }
    if (value.revoked === false) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revoked"], message: "Revoked keys cannot be restored" });
    }
  });

const publicSelect = {
  id: true,
  organizationId: true,
  createdById: true,
  name: true,
  prefix: true,
  scopes: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const notFound = () => NextResponse.json({ error: "API key not found" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "API key management denied" }, { status: 403 });

const loadAdminContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_workspace") ? context : "forbidden" as const;
};

const loadKey = async (organizationId: string, keyId: string) =>
  db.apiKey.findFirst({ where: { id: keyId, organizationId }, select: publicSelect });

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id, keyId } = await params;
  const context = await loadAdminContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const key = await loadKey(id, keyId);
  if (!key) return notFound();
  return NextResponse.json({ data: key });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id, keyId } = await params;
  const context = await loadAdminContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const existing = await loadKey(id, keyId);
  if (!existing) return notFound();
  if (parsed.data.revoked === true && existing.revokedAt) {
    return NextResponse.json({ error: "API key is already revoked" }, { status: 409 });
  }

  const { revoked, ...changes } = parsed.data;
  const data = {
    ...changes,
    ...(revoked === true ? { revokedAt: new Date() } : {}),
  };
  const updated = await db.apiKey.update({ where: { id: keyId }, data, select: publicSelect });

  void logAuditEvent({
    tenantId: id,
    userId: session.user.id,
    action: revoked === true ? "API_KEY_REVOKE" : "API_KEY_UPDATE",
    entity: "ApiKey",
    entityId: keyId,
    ipAddress: getClientIp(request),
    details: {
      prefix: existing.prefix,
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.scopes !== undefined ? { scopes: changes.scopes } : {}),
      ...(changes.expiresAt !== undefined ? { expiresAt: changes.expiresAt } : {}),
    },
  });

  return NextResponse.json({ data: updated });
}
/** Revocation is a soft delete so audit history and last-use metadata remain available. */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();
  const { id, keyId } = await params;
  const context = await loadAdminContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const existing = await loadKey(id, keyId);
  if (!existing) return notFound();
  if (existing.revokedAt) return NextResponse.json({ data: existing });

  const updated = await db.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
    select: publicSelect,
  });

  void logAuditEvent({
    tenantId: id,
    userId: session.user.id,
    action: "API_KEY_REVOKE",
    entity: "ApiKey",
    entityId: keyId,
    ipAddress: getClientIp(request),
    details: { prefix: existing.prefix },
  });

  return NextResponse.json({ data: updated });
}
