import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import { apiError, apiSuccess, type ApiResponseInit } from "@/lib/api-v1/http";
import { authorizeApiRequest, apiWorkspaceScope, resolveApiActorUserId } from "@/lib/api-v1/auth";
import { executeIdempotently } from "@/lib/api-v1/idempotency";
import { decodeCursor, encodeCursor, parseLimit } from "@/lib/api-v1/pagination";
import { ApiClientCreateSchema } from "@/lib/api-v1/schemas";
import { rateLimitHeaders } from "@/lib/api-v1/rate-limit";

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

const requiredIdempotencyKey = (request: NextRequest) => {
  const key = request.headers.get("idempotency-key")?.trim();
  return key && key.length <= 255 ? key : null;
};

export async function GET(request: NextRequest) {
  const auth = await authorizeApiRequest(request, "clients:read", "clients:list");
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const init = responseInit(context.requestId, context.rateLimit);

  const searchParams = new URL(request.url).searchParams;
  const limit = parseLimit(searchParams.get("limit"));
  if (limit === null) return apiError("INVALID_REQUEST", "limit must be an integer between 1 and 100", init);

  const q = searchParams.get("q")?.trim() || undefined;
  if (q && q.length > 200) return apiError("INVALID_REQUEST", "q must be 200 characters or fewer", init);

  const rawCursor = searchParams.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return apiError("INVALID_CURSOR", "cursor is invalid or expired", init);

  const scope = apiWorkspaceScope(context.identity);
  const cursorWhere = cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ],
      }
    : {};

  try {
    const clients = await db.client.findMany({
      where: { ...scope, ...cursorWhere, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { _count: { select: { invoices: true } } },
    });

    const hasNext = clients.length > limit;
    const page = hasNext ? clients.slice(0, limit) : clients;
    const data = await Promise.all(page.map(async (client) => {
      const aggregate = await db.invoice.aggregate({
        where: { ...scope, clientId: client.id, status: "PAID" },
        _sum: { total: true },
      });
      return {
        ...client,
        invoiceCount: client._count.invoices,
        revenue: aggregate._sum.total ?? 0,
      };
    }));

    const last = page[page.length - 1];
    const nextCursor = hasNext && last ? encodeCursor(last) : null;
    return apiSuccess(data, init, { nextCursor, hasMore: hasNext, limit });
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to list clients", { ...init, status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, "clients:write", "clients:create");
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const init = responseInit(context.requestId, context.rateLimit, 201);

  const idempotencyKey = requiredIdempotencyKey(request);
  if (!idempotencyKey) return apiError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for client creation", { ...init, status: 400 });

  const raw = await bodyFromRequest(request);
  if (!raw.ok) return apiError("INVALID_JSON", "Request body must be valid JSON", { ...init, status: 400 });
  const parsed = ApiClientCreateSchema.safeParse(raw.body);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid client payload", { ...init, status: 400 }, parsed.error.flatten());

  const actorUserId = await resolveApiActorUserId(context.identity);
  if (!actorUserId) return apiError("INTERNAL_ERROR", "Unable to resolve the API key owner", { ...init, status: 500 });
  const scope = apiWorkspaceScope(context.identity);

  try {
    const result = await executeIdempotently({
      workspaceId: context.identity.workspaceId,
      namespace: "POST:/api/v1/clients",
      key: idempotencyKey,
      body: parsed.data,
      operation: async () => {
        if (parsed.data.email) {
          const existing = await db.client.findFirst({ where: { ...scope, email: parsed.data.email } });
          if (existing) {
            const error = new Error("A client with this email already exists.");
            (error as Error & { code?: string }).code = "DUPLICATE_EMAIL";
            throw error;
          }
        }

        const client = await db.client.create({
          data: {
            ...parsed.data,
            userId: actorUserId,
            ...scope,
          },
        });

        void logAuditEvent({
          tenantId: context.identity.workspaceId,
          userId: actorUserId,
          action: AuditAction.CLIENT_CREATE,
          entity: AuditEntity.CLIENT,
          entityId: client.id,
          details: { name: client.name, email: client.email, source: "api-v1" },
          ipAddress: getClientIp(request),
        });

        return { status: 201, data: client };
      },
    });

    if (result.kind === "conflict") return apiError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different payload", { ...init, status: 409 });
    return apiSuccess(result.result!.data, init);
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === "DUPLICATE_EMAIL") {
      return apiError("INVALID_REQUEST", error.message, { ...init, status: 409 });
    }
    return apiError("INTERNAL_ERROR", "Unable to create client", { ...init, status: 500 });
  }
}
