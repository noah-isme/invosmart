import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { resend } from "@/lib/email/resend";
import { InvoiceEmail } from "@/emails/InvoiceEmail";
import { logAuditEvent, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from "@/lib/workspaces";
import {
  appendInvoiceDeliveryLog,
  buildInvoiceShareUrl,
  classifyEmailFailure,
  createInvoiceShareToken,
  getInvoiceEmailRetryState,
  getNextEmailRetryAt,
  type InvoiceDeliveryLogEntry,
} from "@/lib/invoice-delivery";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RawInvoiceItem = {
  description?: unknown;
  name?: unknown;
  quantity?: unknown;
  qty?: unknown;
  price?: unknown;
  amount?: unknown;
};

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 240);

const parseItems = (value: unknown) => {
  let items: unknown = value;
  if (typeof value === "string") {
    try {
      items = JSON.parse(value);
    } catch {
      items = [];
    }
  }

  if (!Array.isArray(items)) return [];

  return items.flatMap((item): Array<{ description: string; quantity: number; price: number; amount: number }> => {
    if (!item || typeof item !== "object") return [];
    const raw = item as RawInvoiceItem;
    const quantity = Number(raw.quantity ?? raw.qty ?? 0);
    const price = Number(raw.price ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return [];

    return [{
      description: String(raw.description ?? raw.name ?? "Item"),
      quantity,
      price,
      amount: Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : quantity * price,
    }];
  });
};

const recordDelivery = async (
  invoiceId: string,
  existingLog: unknown,
  entry: InvoiceDeliveryLogEntry,
) => {
  try {
    await db.invoice.update({
      where: { id: invoiceId },
      data: { emailLog: appendInvoiceDeliveryLog(existingLog, entry) },
    });
  } catch (error) {
    // Delivery response should remain useful even if audit persistence fails.
    console.error("Failed to persist invoice delivery log:", error);
  }
};

const retryAfterSeconds = (retryAt: string | null) => {
  if (!retryAt) return undefined;
  const seconds = Math.max(1, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1000));
  return String(seconds);
};

export async function POST(request: NextRequest, context: RouteContext) {
  const httpsCheck = enforceHttps(request);
  if (httpsCheck) return httpsCheck;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limited = rateLimit(request, "invoice-send-email");
    if (limited) return limited;

    const { id } = await context.params;
    const workspace = await resolveWorkspaceContextForRequest(request, session);
    if (!workspace || !canWriteWorkspace(workspace)) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    const body = await request.json().catch(() => ({})) as { to?: unknown };
    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { user: true, client_rel: true },
    });

    const ownsInvoice = workspace.organizationId
      ? invoice?.organizationId === workspace.organizationId
      : invoice?.userId === session.user.id;
    if (!invoice || !ownsInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const requestedEmail = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
    const recipientEmail = requestedEmail || invoice.client_rel?.email || "";
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || request.url;
    const shareToken = createInvoiceShareToken(invoice.id);
    const viewUrl = buildInvoiceShareUrl(baseUrl, invoice.id, shareToken);
    // Keep the existing signed share URL intact while giving mail clients a
    // dedicated payment action that can be handled by the public payment flow.
    const paymentUrl = new URL(viewUrl);
    paymentUrl.searchParams.set("action", "pay");
    const parsedItems = parseItems(invoice.items);
    const retryState = getInvoiceEmailRetryState(invoice.emailLog, recipientEmail);
    const now = new Date();
    if (retryState.exhausted) {
      return NextResponse.json({
        error: retryState.retryable ? "Email retry limit reached" : "Email delivery failed permanently",
        attempt: retryState.nextAttempt - 1,
        retryable: retryState.retryable,
      }, { status: 409 });
    }
    if (retryState.retryAt && new Date(retryState.retryAt).getTime() > now.getTime()) {
      return NextResponse.json({
        error: "Email retry is scheduled",
        attempt: retryState.nextAttempt - 1,
        retryAt: retryState.retryAt,
        retryable: true,
      }, {
        status: 429,
        headers: { "Retry-After": retryAfterSeconds(retryState.retryAt) || "60" },
      });
    }
    const attempt = retryState.nextAttempt;

    const html = await render(
      InvoiceEmail({
        invoiceNumber: invoice.number,
        clientName: invoice.client_rel?.name || invoice.client,
        issuerName: invoice.user.name || "Your Company",
        items: parsedItems,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        currency: invoice.currency,
        dueAt: invoice.dueAt,
        notes: invoice.notes,
        viewUrl,
        paymentUrl: paymentUrl.toString(),
      }),
    );

    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    let result: Awaited<ReturnType<typeof resend.emails.send>>;
    try {
      result = await resend.emails.send({
        from: fromEmail,
        to: recipientEmail,
        subject: `Invoice #${invoice.number} from ${invoice.user.name || "Your Company"}`,
        html,
        tags: [
          { name: "invoice_id", value: invoice.id },
          { name: "invoice_attempt", value: String(attempt) },
        ],
      }, {
        idempotencyKey: `invoice-email-${invoice.id}-${attempt}-${recipientEmail}`,
      });
    } catch (error) {
      const classification = classifyEmailFailure(error);
      const retryAt = classification.retryable ? getNextEmailRetryAt(attempt) : null;
      const failure: InvoiceDeliveryLogEntry = {
        to: recipientEmail,
        status: "failed",
        attempt,
        failedAt: new Date().toISOString(),
        providerStatus: classification.statusCode ? `http_${classification.statusCode}` : "send_error",
        error: classification.reason || errorText(error),
        retryable: classification.retryable,
        ...(retryAt ? { nextRetryAt: retryAt } : {}),
      };
      await recordDelivery(invoice.id, invoice.emailLog, failure);
      void logAuditEvent({
        tenantId: workspace.organizationId,
        action: "INVOICE_EMAIL_FAILED",
        entity: AuditEntity.INVOICE,
        entityId: invoice.id,
        userId: session.user.id,
        details: {
          to: recipientEmail,
          attempt,
          error: failure.error,
          retryable: classification.retryable,
          retryAt,
          statusCode: classification.statusCode,
        },
      });
      return NextResponse.json({
        error: "Failed to send email",
        attempt,
        retryable: classification.retryable,
        ...(retryAt ? { retryAt } : {}),
      }, {
        status: classification.retryable ? 503 : 502,
        ...(retryAt ? { headers: { "Retry-After": retryAfterSeconds(retryAt) || "60" } } : {}),
      });
    }

    const messageId = result.data?.id;
    if (result.error || !messageId) {
      const providerError = result.error || new Error("Resend did not return a provider message id");
      const classification = classifyEmailFailure(providerError);
      const retryAt = classification.retryable ? getNextEmailRetryAt(attempt) : null;
      const failure: InvoiceDeliveryLogEntry = {
        to: recipientEmail,
        status: "failed",
        attempt,
        failedAt: new Date().toISOString(),
        providerStatus: result.error ? "provider_rejected" : "provider_unknown",
        error: classification.reason || errorText(providerError),
        retryable: classification.retryable,
        ...(retryAt ? { nextRetryAt: retryAt } : {}),
      };
      await recordDelivery(invoice.id, invoice.emailLog, failure);
      void logAuditEvent({
        tenantId: workspace.organizationId,
        action: "INVOICE_EMAIL_FAILED",
        entity: AuditEntity.INVOICE,
        entityId: invoice.id,
        userId: session.user.id,
        details: {
          to: recipientEmail,
          attempt,
          error: failure.error,
          retryable: classification.retryable,
          retryAt,
        },
      });
      return NextResponse.json({
        error: "Failed to send email",
        attempt,
        retryable: classification.retryable,
        ...(retryAt ? { retryAt } : {}),
      }, {
        status: classification.retryable ? 503 : 502,
        ...(retryAt ? { headers: { "Retry-After": retryAfterSeconds(retryAt) || "60" } } : {}),
      });
    }

    const success: InvoiceDeliveryLogEntry = {
      to: recipientEmail,
      status: "accepted",
      attempt,
      acceptedAt: new Date().toISOString(),
      providerStatus: "accepted",
      messageId,
    };

    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        emailedAt: new Date(),
        emailLog: appendInvoiceDeliveryLog(invoice.emailLog, success),
        ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}),
      },
    });

    void logAuditEvent({
      tenantId: workspace.organizationId,
      action: AuditAction.INVOICE_EMAIL_ACCEPTED,
      entity: AuditEntity.INVOICE,
      entityId: invoice.id,
      userId: session.user.id,
      details: { to: recipientEmail, messageId, attempt },
    });

    return NextResponse.json({ success: true, messageId, attempt, status: "accepted" });
  } catch (error) {
    console.error("Error sending invoice email:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
