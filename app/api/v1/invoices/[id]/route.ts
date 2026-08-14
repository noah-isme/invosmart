import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { calculateTotals } from "@/lib/invoice-utils";
import { InvoiceStatusEnum } from "@/lib/schemas";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import { apiError, apiNoContent, apiSuccess, type ApiResponseInit } from "@/lib/api-v1/http";
import { authorizeApiRequest, apiWorkspaceScope } from "@/lib/api-v1/auth";
import { ApiInvoicePatchSchema } from "@/lib/api-v1/schemas";
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
  const auth = await authorizeApiRequest(request, "invoices:read", "invoices:detail");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Invoice id is required", init);

  try {
    const invoice = await db.invoice.findFirst({
      where: { id, ...apiWorkspaceScope(apiContext.identity) },
    });
    if (!invoice) return apiError("NOT_FOUND", "Invoice not found", { ...init, status: 404 });
    return apiSuccess(invoice, init);
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to read invoice", { ...init, status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "invoices:write", "invoices:update");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Invoice id is required", init);

  const raw = await bodyFromRequest(request);
  if (!raw.ok) return apiError("INVALID_JSON", "Request body must be valid JSON", { ...init, status: 400 });
  const parsed = ApiInvoicePatchSchema.safeParse(raw.body);
  if (!parsed.success) return apiError("INVALID_REQUEST", "Invalid invoice payload", { ...init, status: 400 }, parsed.error.flatten());

  const scope = apiWorkspaceScope(apiContext.identity);
  try {
    const existing = await db.invoice.findFirst({ where: { id, ...scope } });
    if (!existing) return apiError("NOT_FOUND", "Invoice not found", { ...init, status: 404 });

    if (parsed.data.clientId) {
      const client = await db.client.findFirst({ where: { id: parsed.data.clientId, ...scope } });
      if (!client) return apiError("NOT_FOUND", "Client not found", { ...init, status: 404 });
    }

    const items = parsed.data.items ?? (existing.items as unknown as Array<{ name: string; qty: number; price: number }>);
    const inferredTaxRate = existing.subtotal > 0 ? existing.tax / existing.subtotal : 0;
    const totals = parsed.data.items || parsed.data.taxRate !== undefined
      ? calculateTotals(items, parsed.data.taxRate ?? inferredTaxRate)
      : { subtotal: existing.subtotal, tax: existing.tax, total: existing.total };

    const nextStatus = parsed.data.status ?? existing.status;
    if (!InvoiceStatusEnum.safeParse(nextStatus).success) {
      return apiError("INVALID_REQUEST", "Invalid invoice status", { ...init, status: 400 });
    }

    const updated = await db.invoice.update({
      where: { id },
      data: {
        ...(parsed.data.client === undefined ? {} : { client: parsed.data.client }),
        ...(parsed.data.items === undefined ? {} : { items: parsed.data.items }),
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
        ...(parsed.data.dueAt === undefined ? {} : { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }),
        ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes }),
        ...(parsed.data.clientId === undefined ? {} : { clientId: parsed.data.clientId }),
        ...(parsed.data.currency === undefined ? {} : { currency: parsed.data.currency }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.issuedAt === undefined ? {} : { issuedAt: new Date(parsed.data.issuedAt) }),
      },
    });

    void logAuditEvent({
      tenantId: apiContext.identity.workspaceId,
      userId: apiContext.identity.userId || null,
      action: AuditAction.INVOICE_UPDATE,
      entity: AuditEntity.INVOICE,
      entityId: id,
      details: { source: "api-v1", status: updated.status },
      ipAddress: getClientIp(request),
    });

    return apiSuccess(updated, init);
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to update invoice", { ...init, status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "invoices:write", "invoices:delete");
  if (!auth.ok) return auth.response;
  const { context: apiContext } = auth;
  const init = responseInit(apiContext.requestId, apiContext.rateLimit);
  const id = await getId(context);
  if (!id) return apiError("INVALID_REQUEST", "Invoice id is required", init);

  const scope = apiWorkspaceScope(apiContext.identity);
  try {
    const existing = await db.invoice.findFirst({ where: { id, ...scope } });
    if (!existing) return apiError("NOT_FOUND", "Invoice not found", { ...init, status: 404 });
    await db.invoice.delete({ where: { id } });

    void logAuditEvent({
      tenantId: apiContext.identity.workspaceId,
      userId: apiContext.identity.userId || null,
      action: AuditAction.INVOICE_DELETE,
      entity: AuditEntity.INVOICE,
      entityId: id,
      details: { source: "api-v1", number: existing.number },
      ipAddress: getClientIp(request),
    });

    return apiNoContent({ ...init, status: 204 });
  } catch {
    return apiError("INTERNAL_ERROR", "Unable to delete invoice", { ...init, status: 500 });
  }
}
