import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";

import { authOptions } from "@/server/auth";
import { db } from "@/lib/db";
import { resend } from "@/lib/email/resend";
import { InvoiceEmail } from "@/emails/InvoiceEmail";
import { logAuditEvent, AuditEntity } from "@/lib/audit/auditLogger";
import { enforceHttps } from "@/lib/security";
import { rateLimit } from "@/lib/rate-limit";
import {
  appendInvoiceDeliveryLog,
  buildInvoiceShareUrl,
  createInvoiceShareToken,
  parseInvoiceDeliveryLog,
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
    const body = await request.json().catch(() => ({})) as { to?: unknown };
    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { user: true, client_rel: true },
    });

    if (!invoice || invoice.userId !== session.user.id) {
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
    const parsedItems = parseItems(invoice.items);
    const attempt = parseInvoiceDeliveryLog(invoice.emailLog).filter(
      (entry) => entry.to.toLowerCase() === recipientEmail,
    ).length + 1;

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
      });
    } catch (error) {
      const failure: InvoiceDeliveryLogEntry = {
        to: recipientEmail,
        status: "failed",
        attempt,
        failedAt: new Date().toISOString(),
        error: errorText(error),
      };
      await recordDelivery(invoice.id, invoice.emailLog, failure);
      void logAuditEvent({
        action: "email_failed",
        entity: AuditEntity.INVOICE,
        entityId: invoice.id,
        userId: session.user.id,
        details: { to: recipientEmail, attempt, error: failure.error },
      });
      return NextResponse.json({ error: "Failed to send email", attempt }, { status: 502 });
    }

    if (result.error) {
      const failure: InvoiceDeliveryLogEntry = {
        to: recipientEmail,
        status: "failed",
        attempt,
        failedAt: new Date().toISOString(),
        error: errorText(result.error),
      };
      await recordDelivery(invoice.id, invoice.emailLog, failure);
      void logAuditEvent({
        action: "email_failed",
        entity: AuditEntity.INVOICE,
        entityId: invoice.id,
        userId: session.user.id,
        details: { to: recipientEmail, attempt, error: failure.error },
      });
      return NextResponse.json({ error: "Failed to send email", attempt }, { status: 502 });
    }

    const messageId = result.data?.id;
    const success: InvoiceDeliveryLogEntry = {
      to: recipientEmail,
      status: "sent",
      attempt,
      sentAt: new Date().toISOString(),
      ...(messageId ? { messageId } : {}),
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
      action: "email_sent",
      entity: AuditEntity.INVOICE,
      entityId: invoice.id,
      userId: session.user.id,
      details: { to: recipientEmail, messageId, attempt },
    });

    return NextResponse.json({ success: true, messageId, attempt });
  } catch (error) {
    console.error("Error sending invoice email:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
