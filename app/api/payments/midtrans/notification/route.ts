import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logAuditEvent, AuditAction, AuditEntity } from '@/lib/audit/auditLogger';
import {
  PAYMENT_ATTEMPT_STATUS,
  PAYMENT_PROVIDERS,
  calculateRefundedAmount,
  createMidtransEventId,
  createPaymentAttemptId,
  decidePaymentTransition,
  eventTypeForStatus,
  isFullyRefunded,
  isUniqueConstraintError,
  mapMidtransStatus,
  verifyAmountAndCurrency,
  verifyMidtransSignature,
} from '@/lib/payments/lifecycle';
import {
  claimInvoiceForSettlement,
  getDuplicateSettlementMarker,
  withDuplicateSettlementMarker,
  type DuplicateSettlementMarker,
} from '@/lib/payments/settlement';

type NotificationPayload = Record<string, unknown>;

const toJsonValue = (value: NotificationPayload) => JSON.parse(JSON.stringify(value));

class PaymentLifecycleError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentLifecycleError';
  }
}

function getNotificationDate(notification: NotificationPayload): Date {
  const raw = notification.settlement_time || notification.transaction_time;
  if (typeof raw === 'string' || raw instanceof Date) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function getLegacyInvoiceId(orderId: string): string {
  // Older InvoSmart order IDs were `${invoiceId}-${timestamp}`. New IDs are
  // looked up by PaymentAttempt and never parse an untrusted order ID.
  const separator = orderId.lastIndexOf('-');
  return separator > 0 ? orderId.slice(0, separator) : orderId;
}

function getRefundAmounts(notification: NotificationPayload, fullRefund: boolean) {
  return {
    fullRefund,
    cumulativeRefundedAmount: notification.refunded_amount,
    incrementalRefundAmount: notification.refund_amount,
  };
}

export async function POST(request: Request) {
  try {
    let notification: NotificationPayload;
    try {
      notification = await request.json() as NotificationPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid notification payload' }, { status: 400 });
    }

    const orderId = notification.order_id;
    const statusCode = notification.status_code;
    const grossAmount = notification.gross_amount;
    const signature = notification.signature_key;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    if (
      typeof orderId !== 'string' ||
      !orderId ||
      statusCode === undefined ||
      grossAmount === undefined ||
      typeof signature !== 'string'
    ) {
      return NextResponse.json({ error: 'Invalid notification payload' }, { status: 400 });
    }

    if (!verifyMidtransSignature({
      orderId,
      statusCode,
      grossAmount,
      signature,
      serverKey,
    })) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const nextStatus = mapMidtransStatus({
      transactionStatus: notification.transaction_status,
      fraudStatus: notification.fraud_status,
    });
    if (!nextStatus) {
      // Signature and order validation succeeded; unknown provider statuses
      // are acknowledged so Midtrans does not retry an event we cannot apply.
      return NextResponse.json({ received: true, ignored: true }, { status: 200 });
    }

    const providerPaymentId = notification.transaction_id;
    if (typeof providerPaymentId !== 'string' || !providerPaymentId) {
      return NextResponse.json({ error: 'Missing provider event id' }, { status: 400 });
    }
    const providerEventId = createMidtransEventId(notification);

    let attempt = await db.paymentAttempt.findFirst({
      where: {
        provider: PAYMENT_PROVIDERS.MIDTRANS,
        providerOrderId: orderId,
      },
      include: { invoice: true },
    });

    if (!attempt) {
      // Keep pre-attempt integrations operational. New checkouts always use
      // the attempt branch above; this fallback is only for old order IDs.
      const invoiceId = getLegacyInvoiceId(orderId);
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) {
        return NextResponse.json({ error: 'Payment attempt not found' }, { status: 404 });
      }
      try {
        attempt = await db.paymentAttempt.create({
          data: {
            id: createPaymentAttemptId(),
            invoiceId: invoice.id,
            provider: PAYMENT_PROVIDERS.MIDTRANS,
            idempotencyKey: `legacy:${orderId}`,
            providerOrderId: orderId,
            amount: invoice.total,
            currency: invoice.currency.toUpperCase(),
            status: PAYMENT_ATTEMPT_STATUS.PENDING,
            metadata: { source: 'legacy_midtrans_notification' },
          },
          include: { invoice: true },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        attempt = await db.paymentAttempt.findFirst({
          where: {
            provider: PAYMENT_PROVIDERS.MIDTRANS,
            providerOrderId: orderId,
          },
          include: { invoice: true },
        });
      }
    }

    if (!attempt?.invoice) {
      return NextResponse.json({ error: 'Payment attempt not found' }, { status: 404 });
    }

    const amountCheck = verifyAmountAndCurrency({
      expectedAmount: attempt.amount,
      expectedCurrency: attempt.currency,
      actualAmount: grossAmount,
      // Midtrans does not always include currency for IDR notifications. The
      // amount is still verified against the attempt's immutable currency.
      actualCurrency: notification.currency || attempt.currency,
    });
    if (!amountCheck.ok) {
      return NextResponse.json({ error: amountCheck.reason }, { status: 400 });
    }

    const isRefund = nextStatus === PAYMENT_ATTEMPT_STATUS.REFUNDED;
    const fullRefund = String(notification.transaction_status).toLowerCase() === 'refund';

    let result: {
      duplicate: boolean;
      ignored: boolean;
      paymentId?: string;
      invoiceId: string;
      userId: string;
      status: string;
      duplicateSettlement?: { marker: DuplicateSettlementMarker; firstDetection: boolean };
    };

    try {
      result = await db.$transaction(async (tx) => {
        const txAttempt = await tx.paymentAttempt.findUnique({
          where: { id: attempt!.id },
          include: { invoice: true },
        });
        if (!txAttempt?.invoice) {
          throw new PaymentLifecycleError(404, 'Payment attempt not found');
        }

        const existingEvent = await tx.paymentEvent.findFirst({
          where: {
            provider: PAYMENT_PROVIDERS.MIDTRANS,
            providerEventId,
          },
          select: { id: true },
        });
        if (existingEvent) {
          return {
            duplicate: true,
            ignored: false,
            invoiceId: txAttempt.invoiceId,
            userId: txAttempt.invoice.userId,
            status: txAttempt.status,
          };
        }

        const decision = decidePaymentTransition(txAttempt.status, nextStatus);
        if (decision === 'invalid') {
          throw new PaymentLifecycleError(409, 'Invalid payment status transition');
        }

        const event = await tx.paymentEvent.create({
          data: {
            attemptId: txAttempt.id,
            provider: PAYMENT_PROVIDERS.MIDTRANS,
            providerEventId,
            eventType: eventTypeForStatus(nextStatus),
            status: nextStatus,
            amount: amountCheck.amount,
            currency: amountCheck.currency,
            payload: toJsonValue(notification),
          },
        });
        void event;

        let paymentId: string | undefined;
        const isSettlement = nextStatus === PAYMENT_ATTEMPT_STATUS.SETTLED && decision !== 'ignore';
        const settledAt = getNotificationDate(notification);
        const previousMarker = getDuplicateSettlementMarker(txAttempt.metadata);
        let marker = previousMarker;
        let settlementPayment: Awaited<ReturnType<typeof tx.payment.findFirst>> = null;
        let invoiceClaimedNow = false;

        if (isSettlement && !previousMarker) {
          settlementPayment = await tx.payment.findFirst({ where: { attemptId: txAttempt.id } });
          if (settlementPayment && settlementPayment.gatewayPaymentId !== providerPaymentId) {
            throw new PaymentLifecycleError(409, 'Payment attempt is linked to another provider payment');
          }
          if (!settlementPayment) {
            // First settlement for this attempt: claim the invoice. A count of
            // 0 means the invoice was already settled (by Stripe, by another
            // Midtrans attempt, or manually), so this payment is a duplicate.
            const claimed = await claimInvoiceForSettlement(tx, txAttempt.invoiceId, settledAt);
            if (!claimed) {
              const settled = await tx.payment.findFirst({ where: { invoiceId: txAttempt.invoiceId } });
              marker = {
                reason: 'invoice_already_settled',
                refundRequired: true,
                settledPaymentId: settled?.id ?? null,
                providerEventId,
                providerPaymentId,
                detectedAt: new Date().toISOString(),
              };
            } else {
              invoiceClaimedNow = true;
              settlementPayment = await tx.payment.create({
                data: {
                  invoiceId: txAttempt.invoiceId,
                  attemptId: txAttempt.id,
                  paidAmount: txAttempt.amount,
                  refundedAmount: 0,
                  paidCurrency: txAttempt.currency,
                  paidAt: settledAt,
                  method: typeof notification.payment_type === 'string' ? notification.payment_type : 'midtrans',
                  gatewayProvider: PAYMENT_PROVIDERS.MIDTRANS,
                  gatewayPaymentId: providerPaymentId,
                  gatewayStatus: String(notification.transaction_status),
                  gatewayMetadata: toJsonValue(notification),
                },
              });
            }
          }
        }

        if (marker && isRefund && fullRefund) {
          // The duplicate charge has been refunded at the provider.
          marker = { ...marker, refundRequired: false, refundedAt: new Date().toISOString() };
        }

        if (decision === 'apply' || marker !== previousMarker) {
          await tx.paymentAttempt.update({
            where: { id: txAttempt.id },
            data: {
              ...(decision === 'apply' ? { status: nextStatus, providerPaymentId } : {}),
              metadata: toJsonValue(withDuplicateSettlementMarker(notification, marker)),
            },
          });
        }

        if (settlementPayment) {
          paymentId = settlementPayment.id;
          // Replay of a settlement for an attempt that already owns a Payment
          // (the invoice was claimed by the original settlement).
          if (!invoiceClaimedNow) {
            await tx.invoice.update({
              where: { id: txAttempt.invoiceId },
              data: { status: 'PAID', paidAt: settledAt },
            });
          }
        }

        // A refund of a duplicate settlement has no Payment row and must not
        // touch the invoice: the invoice is still paid by the winning payment.
        if (isRefund && !previousMarker) {
          const payment = await tx.payment.findFirst({ where: { attemptId: txAttempt.id } });
          if (!payment) {
            throw new PaymentLifecycleError(409, 'Refund received before settlement');
          }
          const refundedAmount = calculateRefundedAmount({
            paidAmount: payment.paidAmount,
            currentRefundedAmount: payment.refundedAmount,
            ...getRefundAmounts(notification, fullRefund),
          });
          const fullyRefunded = isFullyRefunded(payment.paidAmount, refundedAmount);
          paymentId = payment.id;
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              refundedAmount,
              gatewayStatus: String(notification.transaction_status),
              gatewayMetadata: toJsonValue(notification),
            },
          });
          await tx.invoice.update({
            where: { id: txAttempt.invoiceId },
            data: {
              status: fullyRefunded ? 'UNPAID' : 'PAID',
              paidAt: fullyRefunded ? null : (txAttempt.invoice.paidAt || getNotificationDate(notification)),
            },
          });
        }

        return {
          duplicate: false,
          ignored: decision === 'ignore',
          paymentId,
          invoiceId: txAttempt.invoiceId,
          userId: txAttempt.invoice.userId,
          status: decision === 'apply' ? nextStatus : txAttempt.status,
          duplicateSettlement: marker ? { marker, firstDetection: !previousMarker } : undefined,
        };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existingEvent = await db.paymentEvent.findFirst({
          where: { provider: PAYMENT_PROVIDERS.MIDTRANS, providerEventId },
          select: { id: true },
        });
        if (existingEvent) {
          return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
        }
      }
      throw error;
    }

    if (result.paymentId && !result.duplicate) {
      void logAuditEvent({
        userId: result.userId,
        action: AuditAction.INVOICE_UPDATE,
        entity: AuditEntity.INVOICE,
        entityId: result.invoiceId,
        details: {
          paymentId: result.paymentId,
          gateway: PAYMENT_PROVIDERS.MIDTRANS,
          event: isRefund ? 'PAYMENT_REFUNDED' : 'PAYMENT_RECEIVED',
          status: result.status,
        },
      });
    }

    if (result.duplicateSettlement?.firstDetection) {
      const { marker } = result.duplicateSettlement;
      console.error(
        `[payments] Duplicate settlement: Midtrans payment ${providerPaymentId} (order ${orderId}) arrived for invoice ${result.invoiceId}, which is already settled. No Payment was created; manual refund required.`,
      );
      void logAuditEvent({
        userId: result.userId,
        action: AuditAction.INVOICE_UPDATE,
        entity: AuditEntity.INVOICE,
        entityId: result.invoiceId,
        details: {
          gateway: PAYMENT_PROVIDERS.MIDTRANS,
          event: 'DUPLICATE_PAYMENT_REFUND_REQUIRED',
          attemptId: attempt.id,
          providerPaymentId,
          amount: amountCheck.amount,
          currency: amountCheck.currency,
          settledPaymentId: marker.settledPaymentId,
        },
      });
    }

    return NextResponse.json({
      received: true,
      duplicate: result.duplicate,
      ignored: result.ignored,
      status: result.status,
      ...(result.duplicateSettlement
        ? { duplicatePayment: true, refundRequired: result.duplicateSettlement.marker.refundRequired }
        : {}),
    }, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentLifecycleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error handling Midtrans notification:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
