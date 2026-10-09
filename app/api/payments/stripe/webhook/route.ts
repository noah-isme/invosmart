import { NextResponse } from 'next/server';
import { isStripeConfigured, stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { logAuditEvent, AuditAction, AuditEntity } from '@/lib/audit/auditLogger';
import { fromStripeMinorUnit } from '@/lib/payments/money';
import {
  PAYMENT_ATTEMPT_STATUS,
  PAYMENT_PROVIDERS,
  calculateRefundedAmount,
  createPaymentAttemptId,
  decidePaymentTransition,
  eventTypeForStatus,
  isFullyRefunded,
  isUniqueConstraintError,
  verifyAmountAndCurrency,
  type PaymentAttemptStatus,
} from '@/lib/payments/lifecycle';
import {
  buildAttemptMetadata,
  getDuplicateSettlementMarker,
  getReviewRequiredMarker,
  lockPaymentAttempt,
  settleInvoiceOnce,
} from '@/lib/payments/settlement';

type StripePayload = Record<string, unknown>;

class PaymentLifecycleError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentLifecycleError';
  }
}

function mapStripeStatus(eventType: string, payload: StripePayload): PaymentAttemptStatus | null {
  if (eventType === 'checkout.session.completed') {
    return payload.payment_status === 'paid'
      ? PAYMENT_ATTEMPT_STATUS.SETTLED
      : PAYMENT_ATTEMPT_STATUS.AUTHORIZED;
  }
  if (eventType === 'checkout.session.async_payment_succeeded') {
    return PAYMENT_ATTEMPT_STATUS.SETTLED;
  }
  if (eventType === 'checkout.session.async_payment_failed') {
    return PAYMENT_ATTEMPT_STATUS.FAILED;
  }
  if (eventType === 'checkout.session.expired') return PAYMENT_ATTEMPT_STATUS.EXPIRED;
  if (eventType === 'charge.refunded') return PAYMENT_ATTEMPT_STATUS.REFUNDED;
  return null;
}

function getStripeAmountAndCurrency(
  payload: StripePayload,
  expectedCurrency: string,
  status: PaymentAttemptStatus,
) {
  const rawAmount = payload.amount_total ?? payload.amount;
  const rawCurrency = payload.currency;
  // For terminal checkout failures/expiry Stripe may omit amount fields. The
  // attempt itself is immutable, while paid/refunded events remain strict.
  const actualAmount = rawAmount === null || rawAmount === undefined
    ? undefined
    : fromStripeMinorUnit(Number(rawAmount), expectedCurrency);
  const actualCurrency = rawCurrency || (status === PAYMENT_ATTEMPT_STATUS.SETTLED || status === PAYMENT_ATTEMPT_STATUS.REFUNDED ? undefined : expectedCurrency);
  return { actualAmount, actualCurrency };
}

export async function POST(request: Request) {
  if (!isStripeConfigured || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Stripe webhook is not configured' }, { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: import('stripe').Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const nextStatus = mapStripeStatus(event.type, event.data.object as unknown as StripePayload);
  if (!nextStatus) {
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  const payload = event.data.object as unknown as StripePayload;
  const isRefund = nextStatus === PAYMENT_ATTEMPT_STATUS.REFUNDED;
  const isChargeRefund = event.type === 'charge.refunded';
  const sessionId = typeof payload.id === 'string' && event.type.startsWith('checkout.session.')
    ? payload.id
    : null;
  const metadata = (payload.metadata || {}) as StripePayload;
  const metadataAttemptId = typeof metadata.attemptId === 'string' ? metadata.attemptId : null;
  const paymentIntentId = typeof payload.payment_intent === 'string'
    ? payload.payment_intent
    : (typeof payload.id === 'string' && isChargeRefund ? payload.id : null);

  let attempt;
  if (metadataAttemptId) {
    attempt = await db.paymentAttempt.findFirst({
      where: { id: metadataAttemptId, provider: PAYMENT_PROVIDERS.STRIPE },
      include: { invoice: true },
    });
  }
  if (!attempt && sessionId) {
    attempt = await db.paymentAttempt.findFirst({
      where: { provider: PAYMENT_PROVIDERS.STRIPE, providerSessionId: sessionId },
      include: { invoice: true },
    });
  }

  // Stripe sessions created before PaymentAttempt was introduced carry only
  // invoiceId metadata. Materialize a legacy attempt once so event dedup and
  // ownership checks apply to those sessions as well.
  if (!attempt && !isChargeRefund && typeof metadata.invoiceId === 'string') {
    const invoice = await db.invoice.findUnique({ where: { id: metadata.invoiceId } });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    try {
      attempt = await db.paymentAttempt.create({
        data: {
          id: createPaymentAttemptId(),
          invoiceId: invoice.id,
          provider: PAYMENT_PROVIDERS.STRIPE,
          idempotencyKey: `legacy:${sessionId || event.id}`,
          providerOrderId: typeof metadata.orderId === 'string' ? metadata.orderId : null,
          providerSessionId: sessionId,
          amount: invoice.total,
          currency: invoice.currency.toUpperCase(),
          status: PAYMENT_ATTEMPT_STATUS.PENDING,
          metadata: { source: 'legacy_stripe_webhook' },
        },
        include: { invoice: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      attempt = sessionId
        ? await db.paymentAttempt.findFirst({
          where: { provider: PAYMENT_PROVIDERS.STRIPE, providerSessionId: sessionId },
          include: { invoice: true },
        })
        : null;
    }
  }

  if (!attempt?.invoice) {
    // A charge refund may not carry Checkout metadata. Find its existing
    // settlement by payment_intent and then follow the attempt relation.
    if (isChargeRefund && paymentIntentId) {
      const payment = await db.payment.findFirst({
        where: { gatewayProvider: PAYMENT_PROVIDERS.STRIPE, gatewayPaymentId: paymentIntentId },
        include: { attempt: { include: { invoice: true } } },
      });
      attempt = payment?.attempt ?? null;
    }
    // A duplicate settlement has no Payment row. Its attempt still records the
    // PaymentIntent, which lets a refund of that charge be resolved.
    if (!attempt?.invoice && isChargeRefund && paymentIntentId) {
      attempt = await db.paymentAttempt.findFirst({
        where: { provider: PAYMENT_PROVIDERS.STRIPE, providerPaymentId: paymentIntentId },
        include: { invoice: true },
      });
    }
  }

  if (!attempt?.invoice) {
    return NextResponse.json({ error: 'Payment attempt not found' }, { status: 404 });
  }

  if (metadata.invoiceId && metadata.invoiceId !== attempt.invoiceId) {
    return NextResponse.json({ error: 'Payment ownership mismatch' }, { status: 403 });
  }

  const { actualAmount, actualCurrency } = getStripeAmountAndCurrency(
    payload,
    attempt.currency,
    nextStatus,
  );
  const amountCheck = actualAmount === undefined
    ? {
      ok: true as const,
      amount: attempt.amount,
      currency: attempt.currency,
    }
    : verifyAmountAndCurrency({
      expectedAmount: attempt.amount,
      expectedCurrency: attempt.currency,
      actualAmount,
      actualCurrency,
    });
  if (!amountCheck.ok) {
    return NextResponse.json({ error: amountCheck.reason }, { status: 400 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Serialise events of the same attempt, then read its fresh status.
      await lockPaymentAttempt(tx, attempt!.id);
      const txAttempt = await tx.paymentAttempt.findUnique({
        where: { id: attempt!.id },
        include: { invoice: true },
      });
      if (!txAttempt?.invoice) throw new PaymentLifecycleError(404, 'Payment attempt not found');

      const existingEvent = await tx.paymentEvent.findFirst({
        where: { provider: PAYMENT_PROVIDERS.STRIPE, providerEventId: event.id },
        select: { id: true },
      });
      if (existingEvent) {
        return { duplicate: true, ignored: false, paymentId: undefined as string | undefined, status: txAttempt.status, invoiceId: txAttempt.invoiceId, userId: txAttempt.invoice.userId };
      }

      const decision = decidePaymentTransition(txAttempt.status, nextStatus);
      if (decision === 'invalid') {
        throw new PaymentLifecycleError(409, 'Invalid payment status transition');
      }

      await tx.paymentEvent.create({
        data: {
          attemptId: txAttempt.id,
          provider: PAYMENT_PROVIDERS.STRIPE,
          providerEventId: event.id,
          eventType: eventTypeForStatus(nextStatus),
          status: nextStatus,
          amount: amountCheck.amount,
          currency: amountCheck.currency,
          payload: JSON.parse(JSON.stringify(payload)),
        },
      });

      let paymentId: string | undefined;
      const isSettlement = nextStatus === PAYMENT_ATTEMPT_STATUS.SETTLED && decision !== 'ignore';
      const settledAt = new Date();
      const previousMarker = getDuplicateSettlementMarker(txAttempt.metadata);
      const previousReview = getReviewRequiredMarker(txAttempt.metadata);
      let marker = previousMarker;
      let review = previousReview;
      let replayPayment: { id: string } | null = null;

      if (isSettlement && !previousMarker) {
        const gatewayPaymentId = paymentIntentId || event.id;
        const outcome = await settleInvoiceOnce(tx, {
          attemptId: txAttempt.id,
          invoiceId: txAttempt.invoiceId,
          gatewayPaymentId,
          paidAt: settledAt,
          createPayment: () => tx.payment.create({
            data: {
              invoiceId: txAttempt.invoiceId,
              attemptId: txAttempt.id,
              paidAmount: txAttempt.amount,
              refundedAmount: 0,
              paidCurrency: txAttempt.currency,
              paidAt: settledAt,
              method: 'stripe',
              gatewayProvider: PAYMENT_PROVIDERS.STRIPE,
              gatewayPaymentId,
              gatewayStatus: typeof payload.payment_status === 'string' ? payload.payment_status : event.type,
              gatewayMetadata: JSON.parse(JSON.stringify(payload)),
            },
          }),
        });
        if (outcome.kind === 'conflict') {
          throw new PaymentLifecycleError(409, 'Payment attempt is linked to another provider payment');
        }
        if (outcome.kind === 'replay') {
          replayPayment = outcome.payment;
        } else if (outcome.kind === 'recorded') {
          paymentId = outcome.payment.id;
          if (outcome.manualReview) {
            // Invoice was already PAID without any Payment row (marked paid
            // by hand). Record the gateway payment, but flag it for review.
            review = {
              reason: 'gateway_payment_on_manually_paid_invoice',
              paymentId: outcome.payment.id,
              providerEventId: event.id,
              detectedAt: settledAt.toISOString(),
            };
          }
        } else {
          marker = {
            reason: 'invoice_already_settled',
            refundRequired: true,
            settledPaymentId: outcome.settledPaymentId,
            providerEventId: event.id,
            providerPaymentId: paymentIntentId,
            detectedAt: settledAt.toISOString(),
          };
        }
      }

      const refundAmountForMarker = payload.amount_refunded === undefined
        ? undefined
        : fromStripeMinorUnit(Number(payload.amount_refunded), txAttempt.currency);
      if (
        marker && isRefund && refundAmountForMarker !== undefined &&
        isFullyRefunded(txAttempt.amount, refundAmountForMarker)
      ) {
        // The duplicate charge has been refunded at the provider.
        marker = { ...marker, refundRequired: false, refundedAt: new Date().toISOString() };
      }

      if (decision === 'apply' || marker !== previousMarker || review !== previousReview) {
        await tx.paymentAttempt.update({
          where: { id: txAttempt.id },
          data: {
            ...(decision === 'apply' ? { status: nextStatus, providerPaymentId: paymentIntentId } : {}),
            metadata: JSON.parse(JSON.stringify(buildAttemptMetadata(payload, { duplicate: marker, review }))),
          },
        });
      }

      if (replayPayment) {
        paymentId = replayPayment.id;
        // Replay of a settlement for an attempt that already owns a Payment.
        await tx.invoice.update({
          where: { id: txAttempt.invoiceId },
          data: { status: 'PAID', paidAt: settledAt },
        });
      }

      // A refund of a duplicate settlement has no Payment row and must not
      // touch the invoice: the invoice is still paid by the winning payment.
      if (isRefund && !previousMarker) {
        const payment = await tx.payment.findFirst({ where: { attemptId: txAttempt.id } });
        if (!payment) throw new PaymentLifecycleError(409, 'Refund received before settlement');
        const amountRefunded = payload.amount_refunded === undefined
          ? undefined
          : fromStripeMinorUnit(Number(payload.amount_refunded), txAttempt.currency);
        const refundedAmount = calculateRefundedAmount({
          paidAmount: payment.paidAmount,
          currentRefundedAmount: payment.refundedAmount,
          cumulativeRefundedAmount: amountRefunded,
          fullRefund: amountRefunded !== undefined && isFullyRefunded(payment.paidAmount, amountRefunded),
        });
        const fullyRefunded = isFullyRefunded(payment.paidAmount, refundedAmount);
        paymentId = payment.id;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedAmount,
            gatewayStatus: event.type,
            gatewayMetadata: JSON.parse(JSON.stringify(payload)),
          },
        });
        await tx.invoice.update({
          where: { id: txAttempt.invoiceId },
          data: {
            status: fullyRefunded ? 'UNPAID' : 'PAID',
            paidAt: fullyRefunded ? null : (txAttempt.invoice.paidAt || new Date()),
          },
        });
      }

      return {
        duplicate: false,
        ignored: decision === 'ignore',
        paymentId,
        status: decision === 'apply' ? nextStatus : txAttempt.status,
        invoiceId: txAttempt.invoiceId,
        userId: txAttempt.invoice.userId,
        duplicateSettlement: marker ? { marker, firstDetection: !previousMarker } : undefined,
        manualReview: review && !previousReview ? review : undefined,
      };
    });

    if (result.paymentId && !result.duplicate) {
      void logAuditEvent({
        userId: result.userId,
        action: AuditAction.INVOICE_UPDATE,
        entity: AuditEntity.INVOICE,
        entityId: result.invoiceId,
        details: {
          paymentId: result.paymentId,
          gateway: PAYMENT_PROVIDERS.STRIPE,
          event: isRefund ? 'PAYMENT_REFUNDED' : 'PAYMENT_RECEIVED',
          status: result.status,
        },
      });
    }

    if (result.duplicateSettlement?.firstDetection) {
      const { marker } = result.duplicateSettlement;
      console.error(
        `[payments] Duplicate settlement: Stripe payment ${paymentIntentId ?? event.id} (attempt ${attempt.id}) arrived for invoice ${result.invoiceId}, which is already settled. No Payment was created; manual refund required.`,
      );
      void logAuditEvent({
        userId: result.userId,
        action: AuditAction.INVOICE_UPDATE,
        entity: AuditEntity.INVOICE,
        entityId: result.invoiceId,
        details: {
          gateway: PAYMENT_PROVIDERS.STRIPE,
          event: 'DUPLICATE_PAYMENT_REFUND_REQUIRED',
          attemptId: attempt.id,
          providerPaymentId: paymentIntentId,
          amount: amountCheck.amount,
          currency: amountCheck.currency,
          settledPaymentId: marker.settledPaymentId,
        },
      });
    }

    if (result.manualReview) {
      console.warn(
        `[payments] Stripe payment ${paymentIntentId ?? event.id} was recorded for invoice ${result.invoiceId}, which was already marked PAID without a Payment. Review required.`,
      );
      void logAuditEvent({
        userId: result.userId,
        action: AuditAction.INVOICE_UPDATE,
        entity: AuditEntity.INVOICE,
        entityId: result.invoiceId,
        details: {
          gateway: PAYMENT_PROVIDERS.STRIPE,
          event: 'GATEWAY_PAYMENT_ON_MANUALLY_PAID_INVOICE',
          attemptId: attempt.id,
          paymentId: result.manualReview.paymentId,
          providerPaymentId: paymentIntentId,
        },
      });
    }

    return NextResponse.json({
      received: true,
      duplicate: result.duplicate,
      ignored: result.ignored,
      status: result.status,
      ...(result.manualReview ? { reviewRequired: true } : {}),
      ...(result.duplicateSettlement
        ? { duplicatePayment: true, refundRequired: result.duplicateSettlement.marker.refundRequired }
        : {}),
    }, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentLifecycleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (isUniqueConstraintError(error)) {
      const existingEvent = await db.paymentEvent.findFirst({
        where: { provider: PAYMENT_PROVIDERS.STRIPE, providerEventId: event.id },
        select: { id: true },
      });
      if (existingEvent) return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    console.error('Error processing Stripe webhook:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
