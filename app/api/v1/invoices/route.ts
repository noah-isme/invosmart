import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { calculateTotals } from "@/lib/invoice-utils";
import { generateInvoiceNumber, InvoiceStatusEnum } from "@/lib/schemas";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import {
  apiError,
  apiSuccess,
  type ApiResponseInit,
} from "@/lib/api-v1/http";
import {
  authorizeApiRequest,
  apiWorkspaceScope,
  resolveApiActorUserId,
} from "@/lib/api-v1/auth";
import { executeIdempotently } from "@/lib/api-v1/idempotency";
import { decodeCursor, encodeCursor, parseLimit } from "@/lib/api-v1/pagination";
import { ApiInvoiceCreateSchema } from "@/lib/api-v1/schemas";
import { rateLimitHeaders } from "@/lib/api-v1/rate-limit";

const listQuerySchema = z.object({
  status: InvoiceStatusEnum.optional(),
  q: z.string().trim().max(200).optional(),
});

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
  const auth = await authorizeApiRequest(request, "invoices:read", "invoices:list");
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const init = responseInit(context.requestId, context.rateLimit);

  const searchParams = new URL(request.url).searchParams;
  const limit = parseLimit(searchParams.get("limit"));
  if (limit === null) {
    return apiError("INVALID_REQUEST", "limit must be an integer between 1 and 100", init);
  }

  const query = listQuerySchema.safeParse({
    status: searchParams.get("status")?.toUpperCase() || undefined,
    q: searchParams.get("q") || undefined,
  });
  if (!query.success) {
    return apiError("INVALID_REQUEST", "Invalid invoice list filter", init, query.error.flatten());
  }

  const rawCursor = searchParams.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    return apiError("INVALID_CURSOR", "cursor is invalid or expired", init);
  }

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
    const invoices = await db.invoice.findMany({
      where: {
        ...scope,
        ...cursorWhere,
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.q ? { client: { contains: query.data.q, mode: "insensitive" } } : {}),
      },
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const hasNext = invoices.length > limit;
    const data = hasNext ? invoices.slice(0, limit) : invoices;
    const last = data[data.length - 1];
    const nextCursor = hasNext && last ? encodeCursor(last) : null;

    return apiSuccess(data, init, { nextCursor, hasMore: hasNext, limit });
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to list invoices", { ...init, status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeApiRequest(request, "invoices:write", "invoices:create");
  if (!auth.ok) return auth.response;
  const { context } = auth;
  const init = responseInit(context.requestId, context.rateLimit, 201);

  const idempotencyKey = requiredIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required for invoice creation", { ...init, status: 400 });
  }

  const raw = await bodyFromRequest(request);
  if (!raw.ok) return apiError("INVALID_JSON", "Request body must be valid JSON", { ...init, status: 400 });
  const parsed = ApiInvoiceCreateSchema.safeParse(raw.body);
  if (!parsed.success) {
    return apiError("INVALID_REQUEST", "Invalid invoice payload", { ...init, status: 400 }, parsed.error.flatten());
  }

  const scope = apiWorkspaceScope(context.identity);
  const actorUserId = await resolveApiActorUserId(context.identity);
  if (!actorUserId) {
    return apiError("INTERNAL_ERROR", "Unable to resolve the API key owner", { ...init, status: 500 });
  }

  try {
    const result = await executeIdempotently({
      workspaceId: context.identity.workspaceId,
      namespace: "POST:/api/v1/invoices",
      key: idempotencyKey,
      body: parsed.data,
      operation: async () => {
        if (parsed.data.clientId) {
          const client = await db.client.findFirst({ where: { id: parsed.data.clientId, ...scope } });
          if (!client) {
            const error = new Error("Client not found");
            (error as Error & { code?: string }).code = "CLIENT_NOT_FOUND";
            throw error;
          }
        }

        const { subtotal, total, tax } = calculateTotals(parsed.data.items, parsed.data.taxRate);
        const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
        const status = parsed.data.status === "SENT" ? "SENT" : "DRAFT";
        if (parsed.data.status && !["DRAFT", "SENT"].includes(parsed.data.status)) {
          const error = new Error("Invalid initial invoice status");
          (error as Error & { code?: string }).code = "INVALID_STATUS";
          throw error;
        }

        const invoice = await db.invoice.create({
          data: {
            number: await generateInvoiceNumber(db, context.identity.workspaceId),
            client: parsed.data.client,
            items: parsed.data.items,
            subtotal,
            tax,
            total,
            status,
            issuedAt: new Date(),
            dueAt,
            paidAt: null,
            notes: parsed.data.notes ?? null,
            currency: parsed.data.currency || "IDR",
            clientId: parsed.data.clientId ?? null,
            userId: actorUserId,
            ...scope,
          },
        });

        void logAuditEvent({
          tenantId: context.identity.workspaceId,
          userId: actorUserId,
          action: AuditAction.INVOICE_CREATE,
          entity: AuditEntity.INVOICE,
          entityId: invoice.id,
          details: { number: invoice.number, total: invoice.total, source: "api-v1" },
          ipAddress: getClientIp(request),
        });

        return { status: 201, data: invoice };
      },
    });

    if (result.kind === "conflict") {
      return apiError("IDEMPOTENCY_CONFLICT", "Idempotency-Key was already used with a different payload", { ...init, status: 409 });
    }

    return apiSuccess(result.result!.data, init);
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (code === "CLIENT_NOT_FOUND") {
      return apiError("NOT_FOUND", "Client not found", { ...init, status: 404 });
    }
    if (code === "INVALID_STATUS") {
      return apiError("INVALID_REQUEST", "Invalid initial invoice status", { ...init, status: 400 });
    }
    return apiError("INTERNAL_ERROR", "Unable to create invoice", { ...init, status: 500 });
  }
}
