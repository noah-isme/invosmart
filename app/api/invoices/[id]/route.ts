import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  InvoiceUpdateSchema,
  type InvoiceUpdateInput,
  InvoiceStatusEnum,
  parseInvoiceStatus,
} from "@/lib/schemas";
import { calculateTotals } from "@/lib/invoice-utils";
import { getStatusSideEffects, isInvoiceOverdue } from "@/lib/invoices";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { captureServerEvent } from "@/lib/server-telemetry";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const notFound = () =>
  NextResponse.json({ error: "Invoice not found" }, { status: 404 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

const resolveId = async (context: RouteContext) => {
  const params = await context.params;
  const idParam = params?.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  return id ?? null;
};

const getInvoiceHandler = async (request: NextRequest, context: RouteContext) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const invoice = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!invoice) {
    return notFound();
  }

  if (invoice.status !== InvoiceStatusEnum.enum.OVERDUE && isInvoiceOverdue(invoice)) {
    const updated = await db.invoice.update({
      where: { id },
      data: { status: InvoiceStatusEnum.enum.OVERDUE },
    });
    void captureServerEvent("invoice_status_auto_overdue", {
      invoiceId: id,
    });
    void logAuditEvent({
      tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
      userId: session.user.id,
      action: AuditAction.INVOICE_AUTO_OVERDUE,
      entity: AuditEntity.INVOICE,
      entityId: id,
      details: {
        number: invoice.number,
        previousStatus: invoice.status,
        nextStatus: InvoiceStatusEnum.enum.OVERDUE,
        dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
        trigger: "lazy_get_evaluation",
      },
      ipAddress: getClientIp(request),
    });
    return NextResponse.json({ data: updated });
  }

  return NextResponse.json({ data: invoice });
};

const validateUpdateBody = async (request: NextRequest) => {
  try {
    const json = await request.json();
    return InvoiceUpdateSchema.safeParse(json);
  } catch {
    return { success: false } as const;
  }
};

const ensureTotals = (payload: InvoiceUpdateInput) => {
  const totals = calculateTotals(payload.items, payload.taxRate);

  if (totals.subtotal !== payload.subtotal || totals.total !== payload.total) {
    return { success: false as const };
  }

  if (totals.tax !== payload.tax) {
    return { success: false as const };
  }

  return { success: true as const, totals };
};

const updateInvoiceHandler = async (request: NextRequest, context: RouteContext) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const parsed = await validateUpdateBody(request);

  if (!parsed.success) {
    return invalidRequest("Invalid payload");
  }

  if (parsed.data.id !== id) {
    return invalidRequest("Invoice id mismatch");
  }

  const totalsCheck = ensureTotals(parsed.data);

  if (!totalsCheck.success) {
    return invalidRequest("Subtotal atau total tidak valid");
  }

  const issuedAt = new Date(parsed.data.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) {
    return invalidRequest("Invalid issuedAt value");
  }

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return invalidRequest("Invalid dueAt value");
  }

  const existing = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  const now = new Date();
  const previousStatus = parseInvoiceStatus(existing.status);
  const nextStatus = parseInvoiceStatus(parsed.data.status);
  const sideEffects = getStatusSideEffects(previousStatus, nextStatus, now);

  const data = {
    client: parsed.data.client,
    items: parsed.data.items,
    subtotal: totalsCheck.totals.subtotal,
    tax: totalsCheck.totals.tax,
    total: totalsCheck.totals.total,
    status: nextStatus,
    issuedAt,
    dueAt,
    notes: parsed.data.notes ?? null,
    currency: parsed.data.currency || "IDR",
    clientId: parsed.data.clientId ?? null,
    ...("paidAt" in sideEffects ? { paidAt: sideEffects.paidAt ?? null } : {}),
  };

  if (sideEffects.issuedAt) {
    data.issuedAt = sideEffects.issuedAt;
  }

  if (
    dueAt &&
    dueAt.getTime() < now.getTime() &&
    nextStatus !== InvoiceStatusEnum.enum.PAID &&
    (nextStatus === InvoiceStatusEnum.enum.SENT || nextStatus === InvoiceStatusEnum.enum.UNPAID)
  ) {
    data.status = InvoiceStatusEnum.enum.OVERDUE;
  }

  const updated = await db.invoice.update({
    where: { id },
    data,
  });

  void captureServerEvent("invoice_updated", {
    invoiceId: id,
    status: updated.status,
    total: Number(updated.total ?? 0),
  });

  if (updated.status === InvoiceStatusEnum.enum.PAID) {
    void captureServerEvent("invoice_paid", {
      invoiceId: id,
      total: Number(updated.total ?? 0),
    });
  }

  void logAuditEvent({
    tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
    userId: session.user.id,
    action: AuditAction.INVOICE_UPDATE,
    entity: AuditEntity.INVOICE,
    entityId: updated.id,
    details: {
      number: existing.number,
      client: updated.client,
      previousStatus,
      nextStatus: updated.status,
      total: Number(updated.total ?? 0),
      subtotal: Number(updated.subtotal ?? 0),
      tax: Number(updated.tax ?? 0),
      paidAt: updated.paidAt ? updated.paidAt.toISOString() : null,
      statusChanged: previousStatus !== updated.status,
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: updated });
};

const deleteInvoiceHandler = async (request: NextRequest, context: RouteContext) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "invoices");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing invoice id");
  }

  const existing = await db.invoice.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  await db.invoice.delete({ where: { id } });

  void captureServerEvent("invoice_deleted", {
    invoiceId: id,
  });

  void logAuditEvent({
    tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
    userId: session.user.id,
    action: AuditAction.INVOICE_DELETE,
    entity: AuditEntity.INVOICE,
    entityId: id,
    details: {
      number: existing.number,
      client: existing.client,
      status: existing.status,
      total: Number(existing.total ?? 0),
    },
    ipAddress: getClientIp(request),
  });

  return new NextResponse(null, { status: 204 });
};

export const GET = withTiming(getInvoiceHandler);
export const PUT = withTiming(updateInvoiceHandler);
export const DELETE = withTiming(deleteInvoiceHandler);
