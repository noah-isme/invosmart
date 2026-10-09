import type { Invoice } from "@prisma/client";
import { getServerSession } from "next-auth";

import { logAuditEvent, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";
import { db } from "@/lib/db";
import { isInvoiceOverdue } from "@/lib/invoices";
import { InvoiceStatusEnum } from "@/lib/schemas";
import { captureServerEvent } from "@/lib/server-telemetry";
import {
  canReadWorkspace,
  resolveWorkspaceContext,
  workspaceScope,
} from "@/lib/workspaces";
import { authOptions } from "@/server/auth";

/**
 * Single source of truth for reading one invoice on behalf of the current
 * session. Used by `GET /api/invoices/[id]` and by the invoice detail server
 * component, so authorization and derived fields cannot drift between them.
 *
 * Rate limiting is intentionally NOT done here: it is a transport concern of
 * the API route (keyed by client IP). Server components call this function
 * directly instead of self-fetching their own API.
 */

export type GetInvoiceFailure = "unauthorized" | "forbidden" | "invalid_id" | "not_found";

export type GetInvoiceResult =
  | { ok: true; invoice: Invoice }
  | { ok: false; reason: GetInvoiceFailure };

export type GetInvoiceInput = {
  /** Invoice id from the route/page params. */
  id: string | null | undefined;
  /**
   * Optional workspace lookup hint (query string / header). Never trusted as
   * an authorization claim; `resolveWorkspaceContext` verifies membership.
   */
  requestedOrganizationId?: string | null;
  /** Client IP recorded on the audit event when the lazy OVERDUE transition fires. */
  ipAddress?: string | null;
};

export const getInvoiceForCurrentUser = async ({
  id,
  requestedOrganizationId,
  ipAddress = null,
}: GetInvoiceInput): Promise<GetInvoiceResult> => {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return { ok: false, reason: "unauthorized" };
  }

  const workspace = await resolveWorkspaceContext(session.user.id, requestedOrganizationId);
  if (!workspace || !canReadWorkspace(workspace)) {
    return { ok: false, reason: "forbidden" };
  }
  const scope = workspaceScope(workspace);

  if (!id) {
    return { ok: false, reason: "invalid_id" };
  }

  const invoice = await db.invoice.findFirst({
    where: { id, ...scope },
  });

  if (!invoice) {
    return { ok: false, reason: "not_found" };
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
      tenantId: workspace.organizationId,
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
      ipAddress,
    });
    return { ok: true, invoice: updated };
  }

  return { ok: true, invoice };
};
