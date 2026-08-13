import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { InvoiceStatusEnum, type InvoiceStatusValue } from "@/lib/schemas";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { authOptions } from "@/server/auth";
import { withTiming } from "@/middleware/withTiming";
import { withSpan } from "@/lib/tracing";
import { logAuditEvent, AuditEntity, getClientIp } from "@/lib/audit/auditLogger";
import { exportToCSV, exportToXLSX, type InvoiceExportData } from "@/lib/export-utils";
import {
  canReadWorkspace,
  resolveWorkspaceContextForRequest,
  workspaceScope,
} from "@/lib/workspaces";

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const forbidden = () =>
  NextResponse.json({ error: "Workspace access denied" }, { status: 403 });

const invalidRequest = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

const handleExport = async (request: NextRequest) => {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) {
    return httpsCheck;
  }

  const limited = rateLimit(request, "export");
  if (limited) {
    return limited;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return unauthorized();
  }

  const workspace = await resolveWorkspaceContextForRequest(request, session);
  if (!workspace || !canReadWorkspace(workspace)) {
    return forbidden();
  }
  const scope = workspaceScope(workspace);

  const searchParams = request.nextUrl?.searchParams ?? new URL(request.url).searchParams;

  const formatParam = (searchParams?.get("format") || "csv").toLowerCase();
  if (formatParam !== "csv" && formatParam !== "xlsx") {
    return invalidRequest("Invalid format. Supported formats: csv, xlsx");
  }

  const statusParam = searchParams?.get("status");
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

  const invoices = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  const exportData: InvoiceExportData[] = invoices.map((inv) => ({
    number: inv.number,
    client: inv.client,
    status: inv.status,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    total: Number(inv.total),
    currency: inv.currency || "IDR",
  }));

  void logAuditEvent({
    tenantId: workspace.organizationId,
    userId: session.user.id,
    action: "INVOICE_EXPORT",
    entity: AuditEntity.INVOICE,
    details: {
      format: formatParam,
      statusFilter: statusFilter ?? "ALL",
      count: exportData.length,
    },
    ipAddress: getClientIp(request),
  });

  const timestamp = new Date().toISOString().split("T")[0];

  if (formatParam === "csv") {
    const csvContent = exportToCSV(exportData);
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-export-${timestamp}.csv"`,
      },
    });
  }

  const xlsxContent = exportToXLSX(exportData);
  return new NextResponse(xlsxContent, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-export-${timestamp}.xlsx"`,
    },
  });
};

export const GET = withTiming(
  withSpan("api.invoices.export", handleExport, {
    op: "http.server",
    attributes: { "api.operation": "export_invoices" },
  }),
  { metricName: "api_invoices_export_get_latency" },
);
