/**
 * Cross-provider settlement guard.
 *
 * Each webhook route runs in its own transaction, so two providers (or two
 * attempts) settling the same invoice must be serialised on shared rows:
 *
 *  1. The PaymentAttempt row is locked (SELECT ... FOR UPDATE) at the start
 *     of the transaction. Two events for the SAME attempt (for example a
 *     Midtrans capture and settlement arriving together) queue here, and the
 *     second one decides its transition from the fresh, committed status.
 *  2. The first settlement of an attempt claims the invoice with a
 *     conditional update (`status <> 'PAID'`). Postgres serialises concurrent
 *     updates of one row; the loser re-evaluates the WHERE clause after the
 *     winner commits and affects 0 rows.
 *  3. When the claim fails, the invoice row is locked and the Payment rows are
 *     inspected: a Payment of this attempt is a replay, a Payment of another
 *     attempt makes this a duplicate, and no Payment at all means the invoice
 *     was marked paid manually.
 */

type RawQueryClient = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
};

type InvoiceClaimClient = {
  invoice: {
    updateMany(args: {
      where: { id: string; status: { not: 'PAID' } };
      data: { status: 'PAID'; paidAt: Date };
    }): Promise<{ count: number }>;
  };
};

export type PaymentLike = { id: string; attemptId: string | null; gatewayPaymentId: string | null };

export type InvoicePaymentLike = PaymentLike & { paidAmount: number; refundedAmount: number };

type PaymentLookupClient = {
  payment: {
    findFirst(args: { where: { attemptId: string } }): Promise<PaymentLike | null>;
    findMany(args: { where: { invoiceId: string } }): Promise<InvoicePaymentLike[]>;
  };
};

export type SettlementClient = RawQueryClient & InvoiceClaimClient & PaymentLookupClient;

/** Row-lock a PaymentAttempt for the rest of the transaction. */
export async function lockPaymentAttempt(tx: RawQueryClient, attemptId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "PaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
}

/** Row-lock an Invoice for the rest of the transaction. */
export async function lockInvoice(tx: RawQueryClient, invoiceId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
}

/** Returns true when this transaction is the one that moved the invoice to PAID. */
export async function claimInvoiceForSettlement(
  tx: InvoiceClaimClient,
  invoiceId: string,
  paidAt: Date,
): Promise<boolean> {
  const { count } = await tx.invoice.updateMany({
    where: { id: invoiceId, status: { not: 'PAID' } },
    data: { status: 'PAID', paidAt },
  });
  return count === 1;
}

export type SettlementOutcome<P extends PaymentLike> =
  /** This attempt already owns the Payment (event replay). */
  | { kind: 'replay'; payment: P }
  /** A Payment was recorded. `manualReview` is true when the invoice was already PAID with no Payment row. */
  | { kind: 'recorded'; payment: P; manualReview: boolean }
  /** Another payment already settled the invoice: this charge must be refunded. */
  | { kind: 'duplicate'; settledPaymentId: string }
  /** The attempt is linked to a different provider payment. */
  | { kind: 'conflict' };

/**
 * Decide what a settlement event means for the invoice. `createPayment` writes
 * the provider-specific Payment row and is only called when one is to be
 * recorded.
 */
export async function settleInvoiceOnce<P extends PaymentLike>(
  tx: SettlementClient,
  input: {
    attemptId: string;
    invoiceId: string;
    gatewayPaymentId: string;
    paidAt: Date;
    createPayment: () => Promise<P>;
  },
): Promise<SettlementOutcome<P>> {
  const ownPayment = async (): Promise<SettlementOutcome<P> | null> => {
    const own = await tx.payment.findFirst({ where: { attemptId: input.attemptId } });
    if (!own) return null;
    return own.gatewayPaymentId === input.gatewayPaymentId
      ? { kind: 'replay', payment: own as P }
      : { kind: 'conflict' };
  };

  const early = await ownPayment();
  if (early) return early;

  if (await claimInvoiceForSettlement(tx, input.invoiceId, input.paidAt)) {
    return { kind: 'recorded', payment: await input.createPayment(), manualReview: false };
  }

  // The invoice is already PAID. Lock it so that concurrent settlements of a
  // manually paid invoice cannot both record a Payment, then look again.
  await lockInvoice(tx, input.invoiceId);
  const backstop = await ownPayment();
  if (backstop) return backstop;

  // A fully refunded Payment no longer settles the invoice: if the invoice was
  // marked PAID again by hand afterwards, a new gateway payment is the only
  // real money and takes the manual-review path below.
  const payments = await tx.payment.findMany({ where: { invoiceId: input.invoiceId } });
  const existing = payments.find((payment) => payment.refundedAmount < payment.paidAmount);
  if (existing) return { kind: 'duplicate', settledPaymentId: existing.id };

  return { kind: 'recorded', payment: await input.createPayment(), manualReview: true };
}

/**
 * PaymentAttemptStatus has no "duplicate" value and adding one needs a
 * migration. A duplicate provider settlement keeps the provider's truth
 * (attempt SETTLED, money captured) but creates no Payment row and carries
 * this marker in the attempt metadata so it can be found and refunded.
 */
export const DUPLICATE_SETTLEMENT_KEY = 'duplicateSettlement';
export const REVIEW_REQUIRED_KEY = 'reviewRequired';

export type DuplicateSettlementMarker = {
  reason: 'invoice_already_settled';
  refundRequired: boolean;
  settledPaymentId: string | null;
  providerEventId: string;
  providerPaymentId: string | null;
  detectedAt: string;
  refundedAt?: string;
};

export type ReviewRequiredMarker = {
  reason: 'gateway_payment_on_manually_paid_invoice';
  paymentId: string;
  providerEventId: string;
  detectedAt: string;
};

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as MetadataRecord) : null;
}

export function getDuplicateSettlementMarker(metadata: unknown): DuplicateSettlementMarker | null {
  const marker = asRecord(asRecord(metadata)?.[DUPLICATE_SETTLEMENT_KEY]);
  return marker ? (marker as unknown as DuplicateSettlementMarker) : null;
}

export function getReviewRequiredMarker(metadata: unknown): ReviewRequiredMarker | null {
  const marker = asRecord(asRecord(metadata)?.[REVIEW_REQUIRED_KEY]);
  return marker ? (marker as unknown as ReviewRequiredMarker) : null;
}

/**
 * Attempt metadata is overwritten with the latest provider payload. Markers
 * are only ever written by this module: any marker key present in a provider
 * payload is dropped first, so an incoming payload cannot forge one, and the
 * real markers are carried across overwrites.
 */
export function buildAttemptMetadata(
  payload: MetadataRecord,
  markers: { duplicate: DuplicateSettlementMarker | null; review: ReviewRequiredMarker | null },
): MetadataRecord {
  const clean: MetadataRecord = { ...payload };
  delete clean[DUPLICATE_SETTLEMENT_KEY];
  delete clean[REVIEW_REQUIRED_KEY];
  if (markers.duplicate) clean[DUPLICATE_SETTLEMENT_KEY] = markers.duplicate;
  if (markers.review) clean[REVIEW_REQUIRED_KEY] = markers.review;
  return clean;
}
