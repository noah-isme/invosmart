/**
 * Cross-provider settlement guard.
 *
 * Each webhook route runs in its own transaction and only locks its own
 * PaymentAttempt, so a Stripe and a Midtrans settlement for the same invoice
 * could both create a Payment. An invoice is settled exactly once by claiming
 * it with a conditional update inside the settlement transaction:
 *
 *   UPDATE "Invoice" SET status = 'PAID', ... WHERE id = $1 AND status <> 'PAID'
 *
 * Postgres serialises concurrent updates of the same row; the second writer
 * re-evaluates the WHERE clause after the first commits, sees PAID and
 * affects 0 rows.
 */

type InvoiceClaimClient = {
  invoice: {
    updateMany(args: {
      where: { id: string; status: { not: 'PAID' } };
      data: { status: 'PAID'; paidAt: Date };
    }): Promise<{ count: number }>;
  };
};

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

/**
 * PaymentAttemptStatus has no "duplicate" value and adding one needs a
 * migration. A duplicate provider settlement keeps the provider's truth
 * (attempt SETTLED, money captured) but creates no Payment row and carries
 * this marker in the attempt metadata so it can be found and refunded.
 */
export const DUPLICATE_SETTLEMENT_KEY = 'duplicateSettlement';

export type DuplicateSettlementMarker = {
  reason: 'invoice_already_settled';
  refundRequired: boolean;
  settledPaymentId: string | null;
  providerEventId: string;
  providerPaymentId: string | null;
  detectedAt: string;
  refundedAt?: string;
};

type MetadataRecord = Record<string, unknown>;

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as MetadataRecord) : null;
}

export function getDuplicateSettlementMarker(metadata: unknown): DuplicateSettlementMarker | null {
  const marker = asRecord(asRecord(metadata)?.[DUPLICATE_SETTLEMENT_KEY]);
  return marker ? (marker as unknown as DuplicateSettlementMarker) : null;
}

export function isDuplicateSettlementAttempt(metadata: unknown): boolean {
  return getDuplicateSettlementMarker(metadata) !== null;
}

/**
 * Attempt metadata is overwritten with the latest provider payload. Carry the
 * duplicate marker across those overwrites so it is never lost.
 */
export function withDuplicateSettlementMarker(
  payload: MetadataRecord,
  marker: DuplicateSettlementMarker | null,
): MetadataRecord {
  return marker ? { ...payload, [DUPLICATE_SETTLEMENT_KEY]: marker } : payload;
}
