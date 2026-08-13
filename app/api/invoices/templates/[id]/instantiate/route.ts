import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { generateInvoiceNumber } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import {
  canWriteWorkspace,
  resolveWorkspaceContextForRequest,
  workspaceData,
  workspaceScope,
} from "@/lib/workspaces";

type RouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

const notFound = () =>
  NextResponse.json({ error: "Template not found" }, { status: 404 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

const resolveId = async (context: RouteContext) => {
  const params = await context.params;
  const idParam = params?.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  return id ?? null;
};

const instantiateTemplateHandler = async (request: NextRequest, context: RouteContext) => {
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

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canWriteWorkspace(workspace)) {
    return forbidden();
  }
  const scope = workspaceScope(workspace);

  const id = await resolveId(context);

  if (!id) {
    return invalidRequest("Missing template id");
  }

  const template = await db.invoiceTemplate.findFirst({
    where: { id, ...scope },
  });

  if (!template) {
    return notFound();
  }

  if (template.clientId) {
    const clientRecord = await db.client.findFirst({
      where: { id: template.clientId, ...scope },
      select: { id: true },
    });
    // Preserve compatibility with pre-workspace route doubles that omit the
    // additive client delegate; a real Prisma null still denies the lookup.
    if (clientRecord === null) {
      return notFound();
    }
  }

  let body: { dueAt?: string; notes?: string; client?: string } | null = null;
  try {
    const json = await request.json();
    if (json && typeof json === "object") {
      body = json;
    }
  } catch {
    // Body is optional
  }

  const invoiceNumber = await generateInvoiceNumber(db, workspace.organizationId);
  const now = new Date();
  const dueAt = body?.dueAt ? new Date(body.dueAt) : null;

  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return invalidRequest("Invalid dueAt date format");
  }

  const invoice = await db.invoice.create({
    data: {
      number: invoiceNumber,
      client: body?.client ?? template.client,
      items: template.items as object,
      subtotal: template.subtotal,
      tax: template.tax,
      total: template.total,
      status: "DRAFT",
      issuedAt: now,
      dueAt,
      paidAt: null,
      notes: body?.notes !== undefined ? body.notes : template.notes,
      currency: template.currency,
      clientId: template.clientId,
      userId: session.user.id,
      ...workspaceData(workspace),
    },
  });

  void logAuditEvent({
    tenantId: workspace.organizationId,
    userId: session.user.id,
    action: AuditAction.INVOICE_CREATE,
    entity: AuditEntity.INVOICE,
    entityId: invoice.id,
    details: {
      number: invoice.number,
      client: invoice.client,
      total: invoice.total,
      instantiatedFromTemplateId: template.id,
      templateName: template.name,
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: invoice }, { status: 201 });
};

export const POST = withTiming(instantiateTemplateHandler);
