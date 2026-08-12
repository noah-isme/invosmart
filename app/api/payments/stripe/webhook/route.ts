import { NextResponse } from 'next/server';
import { stripe } from '@/lib/payments/stripe';
import { db } from '@/lib/db';
import { logAuditEvent, AuditAction, AuditEntity } from '@/lib/audit/auditLogger';
import { fromGatewayMinorUnit } from '@/lib/payments/money';
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
    : fromGatewayMinorUnit(Number(rawAmount), expectedCurrency);
  const actualCurrency = rawCurrency || (status === PAYMENT_ATTEMPT_STATUS.SETTLED || status === PAYMENT_ATTEMPT_STATUS.REFUNDED ? undefined : expectedCurrency);
  return { actualAmount, actualCurrency };
}

export async function POST(request: Request) {
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

      if (decision === 'apply') {
        await tx.paymentAttempt.update({
          where: { id: txAttempt.id },
          data: {
            status: nextStatus,
            providerPaymentId: paymentIntentId,
            metadata: JSON.parse(JSON.stringify(payload)),
          },
        });
      }

      let paymentId: string | undefined;
      if (nextStatus === PAYMENT_ATTEMPT_STATUS.SETTLED && decision !== 'ignore') {
        let payment = await tx.payment.findFirst({ where: { attemptId: txAttempt.id } });
        if (payment && payment.gatewayPaymentId !== paymentIntentId) {
          throw new PaymentLifecycleError(409, 'Payment attempt is linked to another provider payment');
        }
        if (!payment) {
          payment = await tx.payment.create({
            data: {
              invoiceId: txAttempt.invoiceId,
              attemptId: txAttempt.id,
              paidAmount: txAttempt.amount,
              refundedAmount: 0,
              paidCurrency: txAttempt.currency,
              paidAt: new Date(),
              method: 'stripe',
              gatewayProvider: PAYMENT_PROVIDERS.STRIPE,
              gatewayPaymentId: paymentIntentId || event.id,
              gatewayStatus: typeof payload.payment_status === 'string' ? payload.payment_status : event.type,
              gatewayMetadata: JSON.parse(JSON.stringify(payload)),
            },
          });
        }
        paymentId = payment.id;
        await tx.invoice.update({
          where: { id: txAttempt.invoiceId },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }

      if (isRefund) {
        const payment = await tx.payment.findFirst({ where: { attemptId: txAttempt.id } });
        if (!payment) throw new PaymentLifecycleError(409, 'Refund received before settlement');
        const amountRefunded = payload.amount_refunded === undefined
          ? undefined
          : fromGatewayMinorUnit(Number(payload.amount_refunded), txAttempt.currency);
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

    return NextResponse.json({
      received: true,
      duplicate: result.duplicate,
      ignored: result.ignored,
      status: result.status,
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
