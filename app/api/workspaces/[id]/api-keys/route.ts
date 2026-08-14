import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import {
  API_KEY_SCOPES,
  createApiKeyCredentials,
  DEFAULT_API_KEY_SCOPES,
} from "@/lib/api-keys";
import { logAuditEvent, getClientIp } from "@/lib/audit/auditLogger";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";

type RouteContext = { params: Promise<{ id: string }> };

const scopeSchema = z.enum(API_KEY_SCOPES);
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(scopeSchema).min(1).max(API_KEY_SCOPES.length).default([...DEFAULT_API_KEY_SCOPES]),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.scopes).size !== value.scopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scopes"], message: "Scopes must be unique" });
    }
    if (value.expiresAt && value.expiresAt.getTime() <= Date.now()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expiration must be in the future" });
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
const notFound = () => NextResponse.json({ error: "Workspace not found" }, { status: 404 });
const forbidden = () => NextResponse.json({ error: "API key management denied" }, { status: 403 });

const loadAdminContext = async (userId: string, organizationId: string) => {
  const context = await resolveWorkspaceContext(userId, organizationId);
  if (!context || context.organizationId !== organizationId) return null;
  return hasWorkspacePermission(context.role, "manage_workspace") ? context : "forbidden" as const;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const { id } = await params;
  const context = await loadAdminContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const keys = await db.apiKey.findMany({
    where: { organizationId: id },
    orderBy: { createdAt: "desc" },
    select: publicSelect,
  });
  return NextResponse.json({ data: keys });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const { id } = await params;
  const context = await loadAdminContext(session.user.id, id);
  if (context === "forbidden") return forbidden();
  if (!context) return notFound();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const credentials = createApiKeyCredentials();
  const key = await db.apiKey.create({
    data: {
      organizationId: id,
      createdById: session.user.id,
      name: parsed.data.name,
      prefix: credentials.prefix,
      secretHash: credentials.secretHash,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt ?? null,
    },
    select: publicSelect,
  });

  void logAuditEvent({
    tenantId: id,
    userId: session.user.id,
    action: "API_KEY_CREATE",
    entity: "ApiKey",
    entityId: key.id,
    ipAddress: getClientIp(request),
    details: { name: key.name, prefix: key.prefix, scopes: key.scopes, expiresAt: key.expiresAt },
  });

  // The complete token is returned once. Neither the token nor its private
  // portion is included in the persisted record or audit details.
  return NextResponse.json({ data: key, token: credentials.token }, { status: 201 });
}
