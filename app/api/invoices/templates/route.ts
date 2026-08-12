import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvoiceTemplateCreateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { calculateTotals } from "@/lib/invoice-utils";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const invalidRequest = (message: string | object) =>
  NextResponse.json({ error: message }, { status: 400 });

const getTemplates = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "templates");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const templates = await db.invoiceTemplate.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: templates });
};

const createTemplate = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "templates");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return unauthorized();
  }

  const userId = session.user.id;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsed = InvoiceTemplateCreateSchema.safeParse(json);

  if (!parsed.success) {
    return invalidRequest(parsed.error.flatten());
  }

  const { name, invoiceId, client, items, taxRate, currency, notes, clientId } = parsed.data;

  let finalClient = client;
  let finalItems = items;
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let finalCurrency = currency;
  let finalNotes = notes ?? null;
  let finalClientId = clientId ?? null;

  if (invoiceId) {
    const existingInvoice = await db.invoice.findFirst({
      where: { id: invoiceId, userId },
    });

    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    finalClient = finalClient || existingInvoice.client;
    finalItems = (finalItems || existingInvoice.items) as typeof items;
    subtotal = existingInvoice.subtotal;
    tax = existingInvoice.tax;
    total = existingInvoice.total;
    finalCurrency = finalCurrency || existingInvoice.currency;
    finalNotes = finalNotes !== null ? finalNotes : existingInvoice.notes;
    finalClientId = finalClientId !== null ? finalClientId : existingInvoice.clientId;
  } else {
    if (!finalClient || !finalItems || finalItems.length === 0) {
      return invalidRequest("Client name and items are required when creating template");
    }

    const totals = calculateTotals(finalItems, taxRate);
    subtotal = totals.subtotal;
    tax = totals.tax;
    total = totals.total;
  }

  const template = await db.invoiceTemplate.create({
    data: {
      name,
      client: finalClient,
      items: finalItems as object,
      subtotal,
      tax,
      total,
      currency: finalCurrency || "IDR",
      notes: finalNotes,
      clientId: finalClientId,
      userId,
    },
  });

  void logAuditEvent({
    tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
    userId: session.user.id,
    action: AuditAction.INVOICE_CREATE,
    entity: AuditEntity.INVOICE,
    entityId: template.id,
    details: {
      templateName: template.name,
      client: template.client,
      total: template.total,
      currency: template.currency,
      type: "INVOICE_TEMPLATE_CREATE",
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: template }, { status: 201 });
};

export const GET = withTiming(getTemplates, { metricName: "api_templates_get_latency" });
export const POST = withTiming(createTemplate, { metricName: "api_templates_post_latency" });
