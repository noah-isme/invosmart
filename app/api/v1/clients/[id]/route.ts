import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import { apiError, apiNoContent, apiSuccess, type ApiResponseInit } from "@/lib/api-v1/http";
import { authorizeApiRequest, apiWorkspaceScope } from "@/lib/api-v1/auth";
import { ApiClientPatchSchema } from "@/lib/api-v1/schemas";
import { rateLimitHeaders } from "@/lib/api-v1/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

const responseInit = (requestId: string, rateLimit: { limit: number; remaining: number; resetAt: number }, status?: number): ApiResponseInit => ({
  requestId,
  status,
  headers: rateLimitHeaders(rateLimit),
});

const bodyFromRequest = async (request: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false }> => {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
};

const getId = async (context: RouteContext) => (await context.params).id;

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "clients:read", "clients:detail");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Client id is required", init);

  try {
    const client = await db.client.findFirst({
      where: { id, ...apiWorkspaceScope(apiContext.identity) },
      include: {
        invoices: {
          where: apiWorkspaceScope(apiContext.identity),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
        },
      },
    });
    if (!client) return apiError("NOT_FOUND", "Client not found", { ...init, status: 404 });
    return apiSuccess(client, init);
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to read client", { ...init, status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "clients:write", "clients:update");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Client id is required", init);

  const raw = await bodyFromRequest(request);
  if (!raw.ok) return apiError("INVALID_JSON", "Request body must be valid JSON", { ...init, status: 400 });
  const parsed = ApiClientPatchSchema.safeParse(raw.body);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid client payload", { ...init, status: 400 }, parsed.error.flatten());

  const scope = apiWorkspaceScope(apiContext.identity);
  try {
    const existing = await db.client.findFirst({ where: { id, ...scope } });
    if (!existing) return apiError("NOT_FOUND", "Client not found", { ...init, status: 404 });

    if (parsed.data.email && parsed.data.email !== existing.email) {
      const duplicate = await db.client.findFirst({ where: { ...scope, email: parsed.data.email } });
      if (duplicate) return apiError("INVALID_REQUEST", "A client with this email already exists.", { ...init, status: 409 });
    }

    const client = await db.client.update({ where: { id }, data: parsed.data });
    void logAuditEvent({
      tenantId: apiContext.identity.workspaceId,
      userId: apiContext.identity.userId || null,
      action: AuditAction.CLIENT_UPDATE,
      entity: AuditEntity.CLIENT,
      entityId: id,
      details: { source: "api-v1", name: client.name, email: client.email },
      ipAddress: getClientIp(request),
    });
    return apiSuccess(client, init);
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to update client", { ...init, status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "clients:write", "clients:delete");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Client id is required", init);

  const scope = apiWorkspaceScope(apiContext.identity);
  try {
    const client = await db.client.findFirst({
      where: { id, ...scope },
      include: { _count: { select: { invoices: true } } },
    });
    if (!client) return apiError("NOT_FOUND", "Client not found", { ...init, status: 404 });
    if (client._count.invoices > 0) {
      return apiError("INVALID_REQUEST", "Cannot delete a client with existing invoices", { ...init, status: 409 });
    }

    await db.client.delete({ where: { id } });
    void logAuditEvent({
      tenantId: apiContext.identity.workspaceId,
      userId: apiContext.identity.userId || null,
      action: AuditAction.CLIENT_DELETE,
      entity: AuditEntity.CLIENT,
      entityId: id,
      details: { source: "api-v1", name: client.name },
      ipAddress: getClientIp(request),
    });
    return apiNoContent({ ...init, status: 204 });
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to delete client", { ...init, status: 500 });
  }
}
