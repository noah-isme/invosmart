import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  InvoiceCreateSchema,
  InvoiceStatusEnum,
  type InvoiceStatusValue,
  generateInvoiceNumber,
} from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { calculateTotals } from "@/lib/invoice-utils";
import { markUserOverdueInvoices } from "@/lib/invoices";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { captureServerEvent } from "@/lib/server-telemetry";
import { withSpan } from "@/lib/tracing";
import { logAuditEvent, AuditAction, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import {
  canReadWorkspace,
  canWriteWorkspace,
  resolveWorkspaceContextForRequest,
  workspaceData,
  workspaceScope,
} from "@/lib/workspaces";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

const getInvoices = async (request: NextRequest) => {
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

  const userId = session.user.id;
  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) {
    return forbidden();
  }
  const scope = workspaceScope(workspace);

  await markUserOverdueInvoices(db, userId, new Date(), workspace.organizationId);

  const statusParam = request.nextUrl?.searchParams?.get("status");

  let statusFilter: InvoiceStatusValue | undefined;

  if (statusParam && statusParam.toUpperCase() !== "ALL") {
    const parsedStatus = InvoiceStatusEnum.safeParse(statusParam.toUpperCase());

    if (!parsedStatus.success) {
      return invalidRequest("Invalid status filter");
    }

    statusFilter = parsedStatus.data;
  }

  const where = {
    ...scope,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [
    invoices,
    revenueAggregate,
    unpaidCount,
    overdueCount,
    statusCountEntries,
  ] = await Promise.all([
    db.invoice.findMany({
      where,
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    db.invoice.aggregate({
      where: { ...scope, status: InvoiceStatusEnum.enum.PAID },
      _sum: { total: true },
    }),
    db.invoice.count({ where: { ...scope, status: InvoiceStatusEnum.enum.UNPAID } }),
    db.invoice.count({ where: { ...scope, status: InvoiceStatusEnum.enum.OVERDUE } }),
    Promise.all(
      (Object.values(InvoiceStatusEnum.enum) as InvoiceStatusValue[]).map(async (status) => [
        status,
        await db.invoice.count({ where: { ...scope, status } }),
      ]),
    ),
  ]);

  const revenue = revenueAggregate._sum.total ?? 0;
  const countsByStatus = Object.fromEntries(statusCountEntries) as Record<InvoiceStatusValue, number>;
  const allCount = Object.values(countsByStatus).reduce((acc, count) => acc + count, 0);

  return NextResponse.json({
    data: invoices,
    stats: {
      revenue,
      unpaid: unpaidCount,
      overdue: overdueCount,
    },
    filterCounts: {
      ALL: allCount,
      ...countsByStatus,
    },
  });
};

const createInvoice = async (request: NextRequest) => {
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

  const userId = session.user.id;
  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canWriteWorkspace(workspace)) {
    return forbidden();
  }
  const scope = workspaceScope(workspace);

  const json = await request.json();
  const parsed = InvoiceCreateSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const items = parsed.data.items;
  const { subtotal, total, tax } = calculateTotals(items, parsed.data.taxRate);

  const dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    return invalidRequest("Invalid dueAt value");
  }

  if (parsed.data.clientId) {
    const client = await db.client.findFirst({
      where: { id: parsed.data.clientId, ...scope },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
  }

  const invoiceNumber = await generateInvoiceNumber(db, workspace.organizationId);

  const now = new Date();
  const status: InvoiceStatusValue =
    parsed.data.status === InvoiceStatusEnum.enum.SENT
      ? InvoiceStatusEnum.enum.SENT
      : InvoiceStatusEnum.enum.DRAFT;
  if (
    parsed.data.status &&
    parsed.data.status !== InvoiceStatusEnum.enum.DRAFT &&
    parsed.data.status !== InvoiceStatusEnum.enum.SENT
  ) {
    return invalidRequest("Invalid initial invoice status");
  }

  const invoice = await db.invoice.create({
    data: {
      number: invoiceNumber,
      client: parsed.data.client,
      items,
      subtotal,
      tax,
      total,
      status,
      issuedAt: now,
      dueAt,
      paidAt: null,
      notes: parsed.data.notes ?? null,
      currency: parsed.data.currency || "IDR",
      clientId: parsed.data.clientId ?? null,
      userId,
      ...workspaceData(workspace),
    },
  });

  void captureServerEvent("invoice_created", {
    invoiceId: invoice.id,
    status,
    amount: Number(invoice.total ?? 0),
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
      total: Number(invoice.total ?? 0),
      subtotal: Number(invoice.subtotal ?? 0),
      tax: Number(invoice.tax ?? 0),
      status: invoice.status,
      dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
      itemCount: Array.isArray(items) ? items.length : 0,
    },
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({ data: invoice }, { status: 201 });
};

export const GET = withTiming(
  withSpan("api.invoices.list", getInvoices, {
    op: "http.server",
    attributes: { "api.operation": "list_invoices" },
  }),
  { metricName: "api_invoices_get_latency" },
);
export const POST = withTiming(
  withSpan("api.invoices.create", createInvoice, {
    op: "http.server",
    attributes: { "api.operation": "create_invoice" },
  }),
  { metricName: "api_invoices_post_latency" },
);
