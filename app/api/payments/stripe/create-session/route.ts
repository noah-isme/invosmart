import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/lib/db';
import { canWriteWorkspace, resolveWorkspaceContextForRequest } from '@/lib/workspaces';
import { isStripeConfigured } from '@/lib/payments/stripe';
import { PAYMENT_PROVIDERS, isInvoicePayable } from '@/lib/payments/lifecycle';
import {
  checkoutCurrencyError,
  createStripeCheckout,
  findOrCreatePaymentAttempt,
} from '@/lib/payments/checkout';

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

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isStripeConfigured) {
      return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 });
    }

    const workspace = await resolveWorkspaceContextForRequest(request, session);
    if (!workspace || !canWriteWorkspace(workspace)) return NextResponse.json({ error: 'Workspace access denied' }, { status: 403 });

    const { invoiceId } = await request.json();
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID required' }, { status: 400 });
    }

    const invoice = await db.invoice.findFirst({
      where: {
        id: invoiceId,
        ...(workspace.organizationId ? { organizationId: workspace.organizationId } : { userId: session.user.id }),
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'PAID') {
      return NextResponse.json({ error: 'Invoice is already paid' }, { status: 409 });
    }
    if (!isInvoicePayable(invoice.status)) {
      return NextResponse.json({ error: 'Invoice is not payable' }, { status: 409 });
    }

    const currencyError = checkoutCurrencyError(provider, invoice.currency);
    if (currencyError) {
      return NextResponse.json({ error: currencyError }, { status: 422 });
    }

    const result = await findOrCreatePaymentAttempt({
      invoice,
      provider,
      requestedIdempotencyKey: request.headers.get('idempotency-key')?.trim() || null,
      now: new Date(),
    });
    if (result.kind === 'idempotency_conflict') {
      return NextResponse.json({ error: 'Idempotency key has already been used' }, { status: 409 });
    }
    if (result.kind === 'existing') {
      return NextResponse.json(serializeAttempt(result.attempt));
    }

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const attempt = await createStripeCheckout({
      invoice,
      attempt: result.attempt,
      actorUserId: session.user.id,
      successUrl: `${origin}/app/invoices/${invoiceId}?payment=success`,
      cancelUrl: `${origin}/app/invoices/${invoiceId}?payment=cancelled`,
      idempotencyKey: result.attempt.idempotencyKey,
    });

    return NextResponse.json(serializeAttempt(attempt));
  } catch (error) {
    console.error('Error creating Stripe session:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
