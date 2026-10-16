import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import {
  assertInvoiceShareSecretConfigured,
  buildInvoiceShareUrl,
  verifyInvoiceShareToken,
} from '@/lib/invoice-delivery';
import { isStripeConfigured } from '@/lib/payments/stripe';
import { PAYMENT_PROVIDERS, isInvoicePayable } from '@/lib/payments/lifecycle';
import {
  checkoutCurrencyError,
  createMidtransCheckout,
  createStripeCheckout,
  findOrCreatePaymentAttempt,
  isMidtransCheckoutConfigured,
  shareCheckoutIdempotencyKey,
} from '@/lib/payments/checkout';

/**
 * Public checkout for the invoice share link (/share/<id>?token=…).
 *
 * Authorisation is the HMAC share token in the body, bound to the invoice id
 * (lib/invoice-delivery.ts). This route never reads the session or cookies,
 * which is why it is on the CSRF exemption list in lib/security/csrf.ts.
 */

const MAX_BODY_BYTES = 4 * 1024;
const SOURCE = 'share_checkout';

const bodySchema = z.object({
  invoiceId: z.string().min(1).max(200),
  // A missing or empty token is answered like a bad one (404), not 400.
  token: z.string().max(1024).optional(),
  provider: z.enum([PAYMENT_PROVIDERS.STRIPE, PAYMENT_PROVIDERS.MIDTRANS]),
});

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status });
const notFound = () => json({ error: 'Invoice not found' }, 404);

function appBaseUrl(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || new URL(request.url).origin;
}

function withPaymentParam(url: string, payment: 'success' | 'cancelled'): string {
  const parsed = new URL(url);
  parsed.searchParams.set('payment', payment);
  return parsed.toString();
}

export async function POST(request: NextRequest) {
  // Per-instance, per-IP (first x-forwarded-for hop): a coarse first line only.
  const limited = rateLimit(request, 'share-checkout');
  if (limited) return limited;

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, 413);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, 413);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }
  const parsed = bodySchema.safeParse(parsedJson);
  if (!parsed.success) {
    return json({ error: 'Invalid request body' }, 400);
  }
  const { invoiceId, token, provider } = parsed.data;

  try {
    assertInvoiceShareSecretConfigured();
  } catch {
    return json({ error: 'Payment links are not available' }, 503);
  }
  // Same answer for a bad, expired or foreign token and for a missing invoice.
  if (!token || !verifyInvoiceShareToken(token, invoiceId)) return notFound();

  if (provider === PAYMENT_PROVIDERS.STRIPE ? !isStripeConfigured : !isMidtransCheckoutConfigured()) {
    return json({ error: 'Payment provider is not configured' }, 503);
  }

  try {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return notFound();

    if (!isInvoicePayable(invoice.status)) {
      return json({ error: 'Invoice is not payable' }, 409);
    }
    const currencyError = checkoutCurrencyError(provider, invoice.currency);
    if (currencyError) {
      return json({ error: currencyError }, 422);
    }

    const now = new Date();
    const result = await findOrCreatePaymentAttempt({
      invoice,
      provider,
      requestedIdempotencyKey: shareCheckoutIdempotencyKey(provider, invoiceId, now.getTime()),
      now,
      source: SOURCE,
    });
    if (result.kind === 'idempotency_conflict') {
      return json({ error: 'Idempotency key has already been used' }, 409);
    }

    let attempt = result.attempt;
    if (result.kind === 'created') {
      if (provider === PAYMENT_PROVIDERS.STRIPE) {
        const returnUrl = buildInvoiceShareUrl(appBaseUrl(request), invoiceId, token);
        attempt = await createStripeCheckout({
          invoice,
          attempt,
          actorUserId: invoice.userId,
          successUrl: withPaymentParam(returnUrl, 'success'),
          cancelUrl: withPaymentParam(returnUrl, 'cancelled'),
          idempotencyKey: attempt.idempotencyKey,
          source: SOURCE,
        });
      } else {
        attempt = await createMidtransCheckout({
          invoice,
          attempt,
          actorUserId: invoice.userId,
          source: SOURCE,
        });
      }
    }

    if (provider === PAYMENT_PROVIDERS.STRIPE) {
      // A concurrent request created the attempt but its provider call has not
      // finished yet; the client retries shortly.
      if (!attempt.checkoutUrl) return json({ error: 'Checkout is being prepared', retry: true }, 409);
      return json({ provider: PAYMENT_PROVIDERS.STRIPE, url: attempt.checkoutUrl });
    }
    if (!attempt.providerToken) return json({ error: 'Checkout is being prepared', retry: true }, 409);
    return json({ provider: PAYMENT_PROVIDERS.MIDTRANS, token: attempt.providerToken, redirectUrl: attempt.checkoutUrl });
  } catch (error) {
    console.error('Error starting share-link checkout:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Failed to start checkout' }, 500);
  }
}
