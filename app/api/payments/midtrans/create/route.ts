import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/lib/db';
import { midtransSnap } from '@/lib/payments/midtrans';
import {
  ACTIVE_PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_ATTEMPT_STATUS,
  PAYMENT_PROVIDERS,
  createMidtransOrderId,
  createPaymentAttemptId,
  createRetryIdempotencyKey,
  getAttemptExpiry,
  isPaymentAttemptActive,
  isUniqueConstraintError,
} from '@/lib/payments/lifecycle';

const provider = PAYMENT_PROVIDERS.MIDTRANS;

function serializeAttempt(attempt: {
  id: string;
  providerOrderId: string | null;
  providerToken: string | null;
  checkoutUrl: string | null;
  status: string;
  expiresAt: Date | null;
}) {
  return {
    attemptId: attempt.id,
    orderId: attempt.providerOrderId,
    status: attempt.status,
    expiresAt: attempt.expiresAt?.toISOString() ?? null,
    token: attempt.providerToken,
    redirectUrl: attempt.checkoutUrl,
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

      // Expiry is persisted before a retry can create another attempt. This
      // also makes a stale pending checkout visible to reconciliation jobs.
      if (ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(activeAttempt.status)) {
        await db.paymentAttempt.update({
          where: { id: activeAttempt.id },
          data: { status: PAYMENT_ATTEMPT_STATUS.EXPIRED },
        });
      }
    }

    const idempotencyKey = requestedIdempotencyKey || createRetryIdempotencyKey(provider, invoiceId);
    const attemptId = createPaymentAttemptId();
    const providerOrderId = createMidtransOrderId(attemptId);
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
          metadata: { source: 'midtrans_checkout' },
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await db.paymentAttempt.findFirst({
          where: {
            invoiceId,
            provider,
            status: { in: ACTIVE_PAYMENT_ATTEMPT_STATUSES },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return NextResponse.json(serializeAttempt(existing));
      }
      throw error;
    }

    // Prepare items for Midtrans
    type InvoiceItem = { id?: string; rate?: number; quantity?: number; description?: string };
    const items = ((invoice.items as InvoiceItem[]) || []).map((item, index) => ({
      // Item IDs must be deterministic so a retry cannot change the provider
      // payload while retaining the same order_id.
      id: item.id || `item_${index + 1}`,
      price: Math.round(item.rate || 0),
      quantity: item.quantity || 1,
      name: item.description?.substring(0, 50) || 'Item',
    }));

    const transactionDetails = {
      transaction_details: {
        order_id: providerOrderId,
        gross_amount: invoice.total,
      },
      item_details: items,
      customer_details: {
        first_name: invoice.client,
      },
    };

    try {
      const transaction = await midtransSnap.createTransaction(transactionDetails);
      const token = typeof transaction.token === 'string' ? transaction.token : null;
      const redirectUrl = typeof transaction.redirect_url === 'string' ? transaction.redirect_url : null;

      attempt = await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          providerToken: token,
          checkoutUrl: redirectUrl,
          metadata: JSON.parse(JSON.stringify({
            source: 'midtrans_checkout',
            transaction,
          })),
        },
      });

      return NextResponse.json(serializeAttempt(attempt));
    } catch (error) {
      await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: PAYMENT_ATTEMPT_STATUS.FAILED,
          metadata: JSON.parse(JSON.stringify({
            source: 'midtrans_checkout',
            error: error instanceof Error ? error.message : 'provider_error',
          })),
        },
      }).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error('Error creating Midtrans transaction:', error);
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
