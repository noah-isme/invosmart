import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/lib/db';
import { stripe } from '@/lib/payments/stripe';
import { toGatewayMinorUnit } from '@/lib/payments/money';
import {
  ACTIVE_PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_ATTEMPT_STATUS,
  PAYMENT_PROVIDERS,
  createPaymentAttemptId,
  createRetryIdempotencyKey,
  getAttemptExpiry,
  isPaymentAttemptActive,
  isUniqueConstraintError,
} from '@/lib/payments/lifecycle';

const provider = PAYMENT_PROVIDERS.STRIPE;

function serializeAttempt(attempt: {
  id: string;
  providerOrderId: string | null;
  providerSessionId: string | null;
  checkoutUrl: string | null;
  status: string;
  expiresAt: Date | null;
}) {
  return {
    attemptId: attempt.id,
    orderId: attempt.providerOrderId,
    sessionId: attempt.providerSessionId,
    status: attempt.status,
    expiresAt: attempt.expiresAt?.toISOString() ?? null,
    url: attempt.checkoutUrl,
  };
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invoiceId } = await request.json();
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const invoice = await db.invoice.findFirst({
      where: {
        id: invoiceId,
        userId: session.user.id,
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'PAID') {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 409 });
    }

    const requestedIdempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
    const now = new Date();
    const activeAttempt = await db.paymentAttempt.findFirst({
      where: {
        invoiceId,
        provider,
        ...(requestedIdempotencyKey
          ? { idempotencyKey: requestedIdempotencyKey }
          : { status: { in: ACTIVE_PAYMENT_ATTEMPT_STATUSES } }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeAttempt) {
      if (requestedIdempotencyKey && !ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(activeAttempt.status)) {
        return NextResponse.json({ error: 'Idempotency key has already been used' }, { status: 409 });
      }
      if (isPaymentAttemptActive(activeAttempt.status, activeAttempt.expiresAt, now)) {
        return NextResponse.json(serializeAttempt(activeAttempt));
      }
      if (ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(activeAttempt.status)) {
        await db.paymentAttempt.update({
          where: { id: activeAttempt.id },
          data: { status: PAYMENT_ATTEMPT_STATUS.EXPIRED },
        });
      }
    }

    const idempotencyKey = requestedIdempotencyKey || createRetryIdempotencyKey(provider, invoiceId);
    const attemptId = createPaymentAttemptId();
    const providerOrderId = `invo_${attemptId}`;
    const expiresAt = getAttemptExpiry(now);
    let attempt;
    try {
      attempt = await db.paymentAttempt.create({
        data: {
          id: attemptId,
          invoiceId,
          provider,
          idempotencyKey,
          providerOrderId,
          amount: invoice.total,
          currency: invoice.currency.toUpperCase(),
          status: PAYMENT_ATTEMPT_STATUS.PENDING,
          expiresAt,
          metadata: { source: 'stripe_checkout' },
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await db.paymentAttempt.findFirst({
          where: { invoiceId, provider, status: { in: ACTIVE_PAYMENT_ATTEMPT_STATUSES } },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return NextResponse.json(serializeAttempt(existing));
      }
      throw error;
    }

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    type InvoiceItem = { description?: string; rate?: number; quantity?: number };
    const items = (invoice.items as InvoiceItem[]) || [];
    const currency = invoice.currency.toUpperCase();
    const line_items = items.map((item) => ({
      price_data: {
        currency: currency.toLowerCase(),
        product_data: {
          name: item.description || 'Item',
        },
        unit_amount: toGatewayMinorUnit(item.rate || 0, currency),
      },
      quantity: item.quantity || 1,
    }));

    // Invoice totals include tax while the original implementation only sent
    // item subtotal. Add tax as a deterministic line and fall back to one
    // total line if rounding or legacy item data still leaves a mismatch.
    if (invoice.tax > 0) {
      line_items.push({
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: 'Tax' },
          unit_amount: toGatewayMinorUnit(invoice.tax, currency),
        },
        quantity: 1,
      });
    }
    const expectedMinorAmount = toGatewayMinorUnit(invoice.total, currency);
    const lineItemsTotal = line_items.reduce(
      (sum, item) => sum + item.price_data.unit_amount * item.quantity,
      0,
    );
    const finalLineItems = lineItemsTotal === expectedMinorAmount
      ? line_items
      : [{
        price_data: {
          currency: currency.toLowerCase(),
          product_data: { name: `Invoice ${invoice.number}` },
          unit_amount: expectedMinorAmount,
        },
        quantity: 1,
      }];

    try {
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: finalLineItems,
        client_reference_id: providerOrderId,
        success_url: `${origin}/app/invoices/${invoiceId}?payment=success`,
        cancel_url: `${origin}/app/invoices/${invoiceId}?payment=cancelled`,
        metadata: {
          invoiceId,
          userId: session.user.id,
          attemptId: attempt.id,
          orderId: providerOrderId,
        },
      }, { idempotencyKey });

      attempt = await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerSessionId: checkoutSession.id,
          checkoutUrl: checkoutSession.url,
          metadata: JSON.parse(JSON.stringify({ source: 'stripe_checkout', checkoutSession })),
        },
      });

      return NextResponse.json(serializeAttempt(attempt));
    } catch (error) {
      await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PAYMENT_ATTEMPT_STATUS.FAILED,
          metadata: JSON.parse(JSON.stringify({
            source: 'stripe_checkout',
            error: error instanceof Error ? error.message : 'provider_error',
          })),
        },
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
