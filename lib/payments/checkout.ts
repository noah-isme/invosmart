import type { PaymentAttempt } from '@prisma/client';

import { db } from '@/lib/db';
import { SUPPORTED_CURRENCIES } from '@/lib/currency';
import { midtransSnap } from '@/lib/payments/midtrans';
import { stripe } from '@/lib/payments/stripe';
import {
  buildMidtransItemDetails,
  buildStripeLineItems,
  type PayableInvoice,
} from '@/lib/payments/line-items';
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

/**
 * Checkout logic shared by the authenticated checkout routes
 * (app/api/payments/stripe/create-session, app/api/payments/midtrans/create)
 * and the public share-link checkout (app/api/share/checkout). Callers do
 * their own authorisation, invoice lookup and payable/currency checks first.
 */

export type CheckoutProvider = (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];

export type CheckoutInvoice = PayableInvoice & {
  id: string;
  client: string;
};

export type FindOrCreateAttemptResult =
  /** An active attempt was reused (lookup or P2002 fallback); no provider call is needed. */
  | { kind: 'existing'; attempt: PaymentAttempt }
  /** A new PENDING attempt was created; the caller must start the provider checkout. */
  | { kind: 'created'; attempt: PaymentAttempt }
  /** The requested idempotency key belongs to an attempt that is no longer active. */
  | { kind: 'idempotency_conflict' };

const defaultSource = (provider: CheckoutProvider) => `${provider}_checkout`;

/**
 * Reuse an active attempt for the invoice/provider (or the attempt with the
 * requested idempotency key), mark a stale one EXPIRED, otherwise create a new
 * PENDING attempt. Concurrent creates collide on the
 * (provider, idempotencyKey) / (provider, providerOrderId) unique constraints;
 * the loser falls back to the active attempt.
 *
 * With `reuseKeyPrefix` (the share checkout), any active, unexpired attempt
 * whose idempotency key starts with the prefix is reused first, so a request
 * in a later key window still gets the attempt (and checkout URL) an earlier
 * window created. Only attempts with that prefix are ever returned: an
 * owner-flow attempt carries return URLs into the authenticated app.
 */
export async function findOrCreatePaymentAttempt({
  invoice,
  provider,
  requestedIdempotencyKey,
  reuseKeyPrefix,
  now = new Date(),
  source = defaultSource(provider),
}: {
  invoice: CheckoutInvoice;
  provider: CheckoutProvider;
  requestedIdempotencyKey: string | null;
  reuseKeyPrefix?: string;
  now?: Date;
  source?: string;
}): Promise<FindOrCreateAttemptResult> {
  const invoiceId = invoice.id;
  const prefixFilter = reuseKeyPrefix ? { idempotencyKey: { startsWith: reuseKeyPrefix } } : {};

  if (reuseKeyPrefix) {
    const reusable = await db.paymentAttempt.findFirst({
      where: {
        invoiceId,
        provider,
        ...prefixFilter,
        status: { in: ACTIVE_PAYMENT_ATTEMPT_STATUSES },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (reusable) return { kind: 'existing', attempt: reusable };
  }

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
      return { kind: 'idempotency_conflict' };
    }
    if (isPaymentAttemptActive(activeAttempt.status, activeAttempt.expiresAt, now)) {
      return { kind: 'existing', attempt: activeAttempt };
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
  try {
    const attempt = await db.paymentAttempt.create({
      data: {
        id: attemptId,
        invoiceId,
        provider,
        idempotencyKey,
        providerOrderId: createMidtransOrderId(attemptId),
        amount: invoice.total,
        currency: invoice.currency.toUpperCase(),
        status: PAYMENT_ATTEMPT_STATUS.PENDING,
        expiresAt: getAttemptExpiry(now),
        metadata: { source },
      },
    });
    return { kind: 'created', attempt };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await db.paymentAttempt.findFirst({
        where: { invoiceId, provider, ...prefixFilter, status: { in: ACTIVE_PAYMENT_ATTEMPT_STATUSES } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { kind: 'existing', attempt: existing };
    }
    throw error;
  }
}

/** Stripe refuses a Checkout Session `expires_at` less than 30 minutes out. */
const STRIPE_MIN_SESSION_TTL_MS = 30 * 60_000;
/** Covers request latency and clock skew between this server and Stripe. */
const STRIPE_SESSION_EXPIRY_MARGIN_MS = 2 * 60_000;

/**
 * Unix seconds for the Checkout Session `expires_at`: the attempt expiry,
 * raised to Stripe's 30-minute minimum plus a margin. Without it a session
 * stays payable for Stripe's 24-hour default, long after the attempt expired
 * and a retry created a second, also payable, session.
 */
export function stripeSessionExpiresAt(attemptExpiresAt: Date | null, now = new Date()): number {
  const floor = now.getTime() + STRIPE_MIN_SESSION_TTL_MS + STRIPE_SESSION_EXPIRY_MARGIN_MS;
  return Math.ceil(Math.max(attemptExpiresAt?.getTime() ?? 0, floor) / 1000);
}

async function markAttemptFailed(attemptId: string, source: string, error: unknown) {
  await db.paymentAttempt.update({
    where: { id: attemptId },
    data: {
      status: PAYMENT_ATTEMPT_STATUS.FAILED,
      metadata: JSON.parse(JSON.stringify({
        source,
        error: error instanceof Error ? error.message : 'provider_error',
      })),
    },
  }).catch(() => undefined);
}

/**
 * Create the Stripe Checkout Session for a freshly created attempt and store
 * its id/url. The session expires with the attempt (`stripeSessionExpiresAt`)
 * and the attempt expiry is moved to the session's, so an attempt is never
 * treated as expired while its session can still be paid. On a provider
 * error the attempt is marked FAILED and the error is rethrown.
 */
export async function createStripeCheckout({
  invoice,
  attempt,
  actorUserId,
  successUrl,
  cancelUrl,
  idempotencyKey = attempt.idempotencyKey,
  source = defaultSource(PAYMENT_PROVIDERS.STRIPE),
}: {
  invoice: CheckoutInvoice;
  attempt: PaymentAttempt;
  actorUserId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
  source?: string;
}): Promise<PaymentAttempt> {
  const providerOrderId = attempt.providerOrderId ?? createMidtransOrderId(attempt.id);
  const expiresAt = stripeSessionExpiresAt(attempt.expiresAt);
  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: expiresAt,
      // Line items sum to the invoice total exactly (items + tax + rounding
      // adjustment, or a single total line); see lib/payments/line-items.ts.
      line_items: buildStripeLineItems(invoice),
      client_reference_id: providerOrderId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        invoiceId: invoice.id,
        userId: actorUserId,
        attemptId: attempt.id,
        orderId: providerOrderId,
        ...(source === defaultSource(PAYMENT_PROVIDERS.STRIPE) ? {} : { source }),
      },
      // Stripe copies PaymentIntent metadata onto the charge, so a
      // charge.refunded event can be traced back to this attempt.
      payment_intent_data: {
        metadata: { attemptId: attempt.id, invoiceId: invoice.id },
      },
    }, { idempotencyKey });

    return await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerSessionId: checkoutSession.id,
        checkoutUrl: checkoutSession.url,
        expiresAt: new Date(expiresAt * 1000),
        metadata: JSON.parse(JSON.stringify({ source, checkoutSession })),
      },
    });
  } catch (error) {
    await markAttemptFailed(attempt.id, source, error);
    throw error;
  }
}

/**
 * Create the Midtrans Snap transaction for a freshly created attempt and store
 * its token/redirect URL. On a provider error the attempt is marked FAILED and
 * the error is rethrown.
 */
export async function createMidtransCheckout({
  invoice,
  attempt,
  source = defaultSource(PAYMENT_PROVIDERS.MIDTRANS),
}: {
  invoice: CheckoutInvoice;
  attempt: PaymentAttempt;
  /** Recorded for symmetry with Stripe; Snap has no metadata field for it. */
  actorUserId?: string;
  /** Snap's createTransaction takes no idempotency key; order_id is the dedupe key. */
  idempotencyKey?: string;
  source?: string;
}): Promise<PaymentAttempt> {
  const providerOrderId = attempt.providerOrderId ?? createMidtransOrderId(attempt.id);
  const transactionDetails = {
    transaction_details: {
      order_id: providerOrderId,
      gross_amount: invoice.total,
    },
    // item_details must sum to gross_amount exactly (items + tax + any
    // rounding adjustment); see lib/payments/line-items.ts.
    item_details: buildMidtransItemDetails(invoice),
    customer_details: {
      first_name: invoice.client,
    },
  };

  try {
    const transaction = await midtransSnap.createTransaction(transactionDetails);
    const token = typeof transaction.token === 'string' ? transaction.token : null;
    const redirectUrl = typeof transaction.redirect_url === 'string' ? transaction.redirect_url : null;

    return await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        providerToken: token,
        checkoutUrl: redirectUrl,
        metadata: JSON.parse(JSON.stringify({ source, transaction })),
      },
    });
  } catch (error) {
    await markAttemptFailed(attempt.id, source, error);
    throw error;
  }
}

/**
 * Currency rule per provider, shared by every checkout route. Returns the
 * 422 error message, or null when the currency can be charged.
 */
export function checkoutCurrencyError(provider: CheckoutProvider, currency: string): string | null {
  const code = currency.toUpperCase();
  if (provider === PAYMENT_PROVIDERS.MIDTRANS) {
    // Midtrans amounts are whole rupiah; gross_amount carries no currency, so
    // any other currency would be charged as IDR.
    return code === 'IDR' ? null : 'Midtrans only supports IDR invoices';
  }
  // Invoice currency is free text; only charge currencies the app supports.
  return SUPPORTED_CURRENCIES.some((entry) => entry.code === code)
    ? null
    : `Unsupported invoice currency: ${code}`;
}

/** Midtrans needs the server key (Snap API) and the public client key (snap.js). */
export function isMidtransCheckoutConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.MIDTRANS_SERVER_KEY?.trim() && env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY?.trim());
}

/**
 * Provider the public share page starts by default: IDR → Midtrans, anything
 * else → Stripe; when only one provider is configured, that one. Returns null
 * when nothing usable is configured.
 */
export function pickShareCheckoutProvider({
  currency,
  stripeEnabled,
  midtransEnabled,
}: {
  currency: string;
  stripeEnabled: boolean;
  midtransEnabled: boolean;
}): CheckoutProvider | null {
  const preferred: CheckoutProvider = currency.trim().toUpperCase() === 'IDR'
    ? PAYMENT_PROVIDERS.MIDTRANS
    : PAYMENT_PROVIDERS.STRIPE;
  const fallback: CheckoutProvider = preferred === PAYMENT_PROVIDERS.MIDTRANS
    ? PAYMENT_PROVIDERS.STRIPE
    : PAYMENT_PROVIDERS.MIDTRANS;
  const enabled = (provider: CheckoutProvider) =>
    provider === PAYMENT_PROVIDERS.STRIPE ? stripeEnabled : midtransEnabled;

  if (enabled(preferred)) return preferred;
  if (enabled(fallback)) return fallback;
  return null;
}

const SHARE_ATTEMPT_WINDOW_MS = 30_000;

/**
 * Prefix shared by every share-checkout idempotency key of one invoice and
 * provider; findOrCreatePaymentAttempt reuses an active attempt with it
 * across windows.
 */
export function shareCheckoutKeyPrefix(provider: CheckoutProvider, invoiceId: string): string {
  return `share:${provider}:${invoiceId}:`;
}

/**
 * Server-side idempotency key for the public share checkout; any client
 * Idempotency-Key header is ignored there. Requests for the same
 * invoice/provider within one 30 s window share a key, so the
 * (provider, idempotencyKey) unique constraint collapses concurrent requests
 * from any instance onto one attempt, and at most one new attempt per invoice
 * and provider is created per window. A later window first reuses the active
 * share attempt (see `reuseKeyPrefix`), so a new one is only created once the
 * previous one is no longer active.
 */
export function shareCheckoutIdempotencyKey(provider: CheckoutProvider, invoiceId: string, nowMs: number): string {
  return `${shareCheckoutKeyPrefix(provider, invoiceId)}${shareCheckoutWindow(nowMs)}`;
}

function shareCheckoutWindow(nowMs: number): number {
  return Math.floor(nowMs / SHARE_ATTEMPT_WINDOW_MS);
}

/** Whole seconds until the share key window of `nowMs` ends (1–30). */
export function secondsUntilNextShareWindow(nowMs: number): number {
  const windowEnd = (shareCheckoutWindow(nowMs) + 1) * SHARE_ATTEMPT_WINDOW_MS;
  return Math.max(1, Math.ceil((windowEnd - nowMs) / 1000));
}
