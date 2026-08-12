import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { logAuditEvent, AuditAction, AuditEntity } from "@/lib/audit/auditLogger";
import { verifyResendWebhook } from "@/lib/email/resend";
import {
  applyInvoiceDeliveryStatusUpdate,
  normalizeResendEventStatus,
  parseInvoiceDeliveryLog,
} from "@/lib/invoice-delivery";

type ResendEventData = {
  email_id?: unknown;
  message_id?: unknown;
  to?: unknown;
  tags?: unknown;
  created_at?: unknown;
  failed?: { reason?: unknown };
  bounce?: { message?: unknown; type?: unknown; subType?: unknown };
  suppressed?: { message?: unknown; type?: unknown };
};

type ResendEvent = {
  type?: unknown;
  created_at?: unknown;
  data?: ResendEventData;
};

const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;

const getEventError = (eventType: string, data: ResendEventData) => {
  if (eventType === "email.failed") return stringValue(data.failed?.reason);
  if (eventType === "email.bounced") {
    return stringValue(data.bounce?.message) || [stringValue(data.bounce?.type), stringValue(data.bounce?.subType)].filter(Boolean).join("/") || undefined;
  }
  if (eventType === "email.suppressed") return stringValue(data.suppressed?.message) || stringValue(data.suppressed?.type);
  return undefined;
};

const getInvoiceIdFromTags = (tags: unknown) => {
  if (!tags || typeof tags !== "object") return undefined;
  const value = (tags as Record<string, unknown>).invoice_id;
  return stringValue(value);
};

const getRecipient = (value: unknown) => {
  if (Array.isArray(value)) return stringValue(value.find((item) => typeof item === "string"));
  return stringValue(value);
};

const actionByStatus: Record<string, AuditAction> = {
  accepted: AuditAction.INVOICE_EMAIL_ACCEPTED,
  sent: AuditAction.INVOICE_EMAIL_ACCEPTED,
  delivered: AuditAction.INVOICE_EMAIL_DELIVERED,
  delayed: AuditAction.INVOICE_EMAIL_DELAYED,
  failed: AuditAction.INVOICE_EMAIL_FAILED,
  bounced: AuditAction.INVOICE_EMAIL_BOUNCED,
  complained: AuditAction.INVOICE_EMAIL_COMPLAINED,
  suppressed: AuditAction.INVOICE_EMAIL_SUPPRESSED,
};

export async function POST(request: Request) {
  const payload = await request.text();
  let event: ResendEvent;
  const eventId = request.headers.get("svix-id") || request.headers.get("webhook-id") || undefined;

  try {
    event = verifyResendWebhook(payload, {
      id: eventId,
      timestamp: request.headers.get("svix-timestamp") || request.headers.get("webhook-timestamp") || undefined,
      signature: request.headers.get("svix-signature") || request.headers.get("webhook-signature") || undefined,
    }) as unknown as ResendEvent;
  } catch (error) {
    console.warn("[ResendWebhook] signature verification failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  const eventType = stringValue(event.type);
  const status = normalizeResendEventStatus(eventType);
  if (!status || !event.data || !eventType) {
    // Acknowledge valid but unsupported Resend events so they are not retried.
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  const data = event.data;
  const messageId = stringValue(data.email_id) || stringValue(data.message_id);
  const alternateMessageId = stringValue(data.message_id);
  const recipient = getRecipient(data.to);
  const invoiceId = getInvoiceIdFromTags(data.tags);

  try {
    let invoice = invoiceId
      ? await db.invoice.findUnique({ where: { id: invoiceId } })
      : null;

    // Older sends predate Resend tags. Resolve those messages from the JSON
    // history while keeping the current schema untouched.
    if (!invoice && (messageId || alternateMessageId || recipient)) {
      const candidates = await db.invoice.findMany({
        // Prisma's JSON nullable filter differs between client versions. The
        // fallback is only used for legacy untagged messages, so keep the
        // query portable and filter the selected logs in memory.
        where: {},
        select: { id: true, emailLog: true },
      });
      const match = candidates.find((candidate) => parseInvoiceDeliveryLog(candidate.emailLog).some((entry) => {
        if (messageId || alternateMessageId) {
          return Boolean((messageId && entry.messageId === messageId) ||
            (alternateMessageId && entry.messageId === alternateMessageId));
        }
        return Boolean(recipient && entry.to.trim().toLowerCase() === recipient.toLowerCase());
      }));
      if (match) invoice = await db.invoice.findUnique({ where: { id: match.id } });
    }

    if (!invoice) {
      return NextResponse.json({ received: true, matched: false }, { status: 200 });
    }

    const update = applyInvoiceDeliveryStatusUpdate(invoice.emailLog, {
      status,
      recipient,
      messageId,
      alternateMessageId,
      providerStatus: eventType,
      providerEventId: eventId,
      occurredAt: stringValue(data.created_at) || stringValue(event.created_at),
      error: getEventError(eventType, data),
      retryable: status === "delayed",
    });

    if (!update.matched || update.duplicate) {
      return NextResponse.json({ received: true, matched: update.matched, duplicate: update.duplicate }, { status: 200 });
    }

    await db.invoice.update({
      where: { id: invoice.id },
      data: { emailLog: update.entries },
    });

    void logAuditEvent({
      action: actionByStatus[status] || `INVOICE_EMAIL_${status.toUpperCase()}`,
      entity: AuditEntity.INVOICE,
      entityId: invoice.id,
      userId: invoice.userId,
      details: {
        provider: "resend",
        event: eventType,
        eventId,
        messageId,
        status,
        recipient,
        duplicate: false,
      },
    });

    return NextResponse.json({ received: true, matched: true, status }, { status: 200 });
  } catch (error) {
    console.error("[ResendWebhook] failed to persist delivery event", error);
    // A 5xx tells Resend to retry a valid event when our database is down.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

export const runtime = "nodejs";
