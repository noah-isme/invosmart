import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvoiceTemplateUpdateSchema } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { calculateTotals } from "@/lib/invoice-utils";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const notFound = () =>
  NextResponse.json({ error: "Template not found" }, { status: 404 });

const invalidRequest = (message: string | object) =>
  NextResponse.json({ error: message }, { status: 400 });

const resolveId = async (context: RouteContext) => {
  const params = await context.params;
  const idParam = params?.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  return id ?? null;
};

const getTemplateHandler = async (request: NextRequest, context: RouteContext) => {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing template id");
  }

  const template = await db.invoiceTemplate.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!template) {
    return notFound();
  }

  return NextResponse.json({ data: template });
};

const updateTemplateHandler = async (request: NextRequest, context: RouteContext) => {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing template id");
  }

  const existing = await db.invoiceTemplate.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return invalidRequest("Invalid JSON body");
  }

  const parsed = InvoiceTemplateUpdateSchema.safeParse(json);

  if (!parsed.success) {
    return invalidRequest(parsed.error.flatten());
  }

  const { name, client, items, taxRate, currency, notes, clientId } = parsed.data;

  const updatedData: Record<string, unknown> = {};

  if (name !== undefined) updatedData.name = name;
  if (client !== undefined) updatedData.client = client;
  if (currency !== undefined) updatedData.currency = currency;
  if (notes !== undefined) updatedData.notes = notes;
  if (clientId !== undefined) updatedData.clientId = clientId;

  if (items !== undefined) {
    updatedData.items = items;
    const totals = calculateTotals(items, taxRate ?? 0.1);
    updatedData.subtotal = totals.subtotal;
    updatedData.tax = totals.tax;
    updatedData.total = totals.total;
  } else if (taxRate !== undefined && Array.isArray(existing.items)) {
    const totals = calculateTotals(existing.items as never[], taxRate);
    updatedData.subtotal = totals.subtotal;
    updatedData.tax = totals.tax;
    updatedData.total = totals.total;
  }

  const updated = await db.invoiceTemplate.update({
    where: { id },
    data: updatedData,
  });

  void logAuditEvent({
    tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
    userId: session.user.id,
    action: AuditAction.INVOICE_UPDATE,
    entity: AuditEntity.INVOICE,
    entityId: updated.id,
    details: {
      templateName: updated.name,
      type: "INVOICE_TEMPLATE_UPDATE",
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: updated });
};

const deleteTemplateHandler = async (request: NextRequest, context: RouteContext) => {
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

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing template id");
  }

  const existing = await db.invoiceTemplate.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!existing) {
    return notFound();
  }

  await db.invoiceTemplate.delete({ where: { id } });

  void logAuditEvent({
    tenantId: (session.user as { tenantId?: string })?.tenantId ?? null,
    userId: session.user.id,
    action: AuditAction.INVOICE_DELETE,
    entity: AuditEntity.INVOICE,
    entityId: id,
    details: {
      templateName: existing.name,
      type: "INVOICE_TEMPLATE_DELETE",
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ message: "Template deleted", success: true }, { status: 200 });
};

export const GET = withTiming(getTemplateHandler);
export const PUT = withTiming(updateTemplateHandler);
export const DELETE = withTiming(deleteTemplateHandler);
