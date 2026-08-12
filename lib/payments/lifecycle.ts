import crypto from "node:crypto";

export const PAYMENT_PROVIDERS = {
  MIDTRANS: "midtrans",
  STRIPE: "stripe",
} as const;

export const PAYMENT_ATTEMPT_STATUS = {
  PENDING: "PENDING",
  AUTHORIZED: "AUTHORIZED",
  SETTLED: "SETTLED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

export type PaymentAttemptStatus =
  (typeof PAYMENT_ATTEMPT_STATUS)[keyof typeof PAYMENT_ATTEMPT_STATUS];

export const PAYMENT_EVENT_TYPE = {
  PENDING: "PENDING",
  AUTHORIZED: "AUTHORIZED",
  SETTLED: "SETTLED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;

export type PaymentEventType =
  (typeof PAYMENT_EVENT_TYPE)[keyof typeof PAYMENT_EVENT_TYPE];

export const ACTIVE_PAYMENT_ATTEMPT_STATUSES: PaymentAttemptStatus[] = [
  PAYMENT_ATTEMPT_STATUS.PENDING,
  PAYMENT_ATTEMPT_STATUS.AUTHORIZED,
];

export const PAYMENT_ATTEMPT_TTL_MINUTES = 30;

/**
 * A payment attempt ID is generated before calling a provider. The resulting
 * order/session identifier is therefore stable across retries and webhook
 * deliveries, while remaining below Midtrans' order_id length limit.
 */
export function createPaymentAttemptId(): string {
  return crypto.randomUUID();
}

export function createMidtransOrderId(attemptId: string): string {
  return `invo_${attemptId}`;
}

export function createDefaultIdempotencyKey(provider: string, invoiceId: string): string {
  return `${provider}:invoice:${invoiceId}`;
}

export function createRetryIdempotencyKey(provider: string, invoiceId: string): string {
  return `${createDefaultIdempotencyKey(provider, invoiceId)}:retry:${crypto.randomUUID()}`;
}

export function getAttemptExpiry(now = new Date(), ttlMinutes = PAYMENT_ATTEMPT_TTL_MINUTES): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function normalizeCurrency(currency: unknown): string | null {
  if (typeof currency !== "string") return null;
  const normalized = currency.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

export function amountsMatch(expected: number, actual: unknown): boolean {
  const parsed = typeof actual === "number" ? actual : Number(actual);
  return Number.isFinite(parsed) && Math.round(parsed) === Math.round(expected);
}

export function verifyAmountAndCurrency(input: {
  expectedAmount: number;
  expectedCurrency: string;
  actualAmount: unknown;
  actualCurrency: unknown;
}): { ok: true; amount: number; currency: string } | { ok: false; reason: string } {
  const currency = normalizeCurrency(input.actualCurrency);
  if (!currency) {
    return { ok: false, reason: "Missing or invalid payment currency" };
  }

  const expectedCurrency = normalizeCurrency(input.expectedCurrency);
  if (!expectedCurrency || currency !== expectedCurrency) {
    return { ok: false, reason: "Payment currency does not match invoice" };
  }

  const amount = typeof input.actualAmount === "number"
    ? input.actualAmount
    : Number(input.actualAmount);
  if (!Number.isFinite(amount)) {
    return { ok: false, reason: "Missing or invalid payment amount" };
  }
  if (!amountsMatch(input.expectedAmount, amount)) {
    return { ok: false, reason: "Payment amount does not match invoice" };
  }

  return { ok: true, amount, currency };
}

/**
 * Verify Midtrans' SHA-512 notification signature without leaking an early
 * comparison exit. The provider signs order_id + status_code + gross_amount
 * + server key exactly as received, so values are stringified first.
 */
export function verifyMidtransSignature(input: {
  orderId: unknown;
  statusCode: unknown;
  grossAmount: unknown;
  signature: unknown;
  serverKey: string;
}): boolean {
  if (
    typeof input.orderId !== "string" ||
    typeof input.signature !== "string" ||
    input.statusCode === undefined ||
    input.grossAmount === undefined ||
    !input.serverKey
  ) {
    return false;
  }

  const expected = crypto
    .createHash("sha512")
    .update(`${input.orderId}${String(input.statusCode)}${String(input.grossAmount)}${input.serverKey}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(input.signature, "utf8");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function mapMidtransStatus(input: {
  transactionStatus?: unknown;
  fraudStatus?: unknown;
}): PaymentAttemptStatus | null {
  const transactionStatus = String(input.transactionStatus ?? "").toLowerCase();
  const fraudStatus = String(input.fraudStatus ?? "").toLowerCase();

  if (transactionStatus === "capture") {
    return fraudStatus === "challenge"
      ? PAYMENT_ATTEMPT_STATUS.AUTHORIZED
      : PAYMENT_ATTEMPT_STATUS.SETTLED;
  }
  if (transactionStatus === "settlement") return PAYMENT_ATTEMPT_STATUS.SETTLED;
  if (transactionStatus === "pending") return PAYMENT_ATTEMPT_STATUS.PENDING;
  if (transactionStatus === "expire") return PAYMENT_ATTEMPT_STATUS.EXPIRED;
  if (transactionStatus === "cancel") return PAYMENT_ATTEMPT_STATUS.CANCELLED;
  if (transactionStatus === "deny") return PAYMENT_ATTEMPT_STATUS.FAILED;
  if (transactionStatus === "refund" || transactionStatus === "partial_refund") {
    return PAYMENT_ATTEMPT_STATUS.REFUNDED;
  }
  return null;
}

export function eventTypeForStatus(status: PaymentAttemptStatus): PaymentEventType {
  return status as PaymentEventType;
}

/**
 * Midtrans' transaction_id identifies the payment, not an individual
 * notification. Include lifecycle fields so pending → settlement and each
 * refund can be recorded independently while identical retries hash to the
 * same event ID. A provider notification_id takes precedence when present.
 */
export function createMidtransEventId(notification: Record<string, unknown>): string {
  if (typeof notification.notification_id === "string" && notification.notification_id) {
    return notification.notification_id;
  }
  const fingerprint = {
    transactionId: notification.transaction_id,
    orderId: notification.order_id,
    transactionStatus: notification.transaction_status,
    fraudStatus: notification.fraud_status,
    statusCode: notification.status_code,
    grossAmount: notification.gross_amount,
    settlementTime: notification.settlement_time,
    transactionTime: notification.transaction_time,
    refundKey: notification.refund_key,
    refundAmount: notification.refund_amount,
    refundedAmount: notification.refunded_amount,
  };
  return `midtrans_${crypto.createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex")}`;
}

export type PaymentTransitionDecision =
  | "apply"
  | "duplicate"
  | "ignore"
  | "invalid";

/**
 * Provider webhooks are at-least-once and can arrive out of order. This table
 * accepts only valid forward lifecycle transitions. Stale events are ignored
 * (but should still be recorded in PaymentEvent for audit/replay analysis).
 */
export function decidePaymentTransition(
  current: PaymentAttemptStatus,
  next: PaymentAttemptStatus,
): PaymentTransitionDecision {
  if (current === next) return "duplicate";

  const legal: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
    PENDING: ["AUTHORIZED", "SETTLED", "EXPIRED", "CANCELLED", "FAILED"],
    AUTHORIZED: ["SETTLED", "EXPIRED", "CANCELLED", "FAILED"],
    SETTLED: ["REFUNDED"],
    EXPIRED: [],
    CANCELLED: [],
    FAILED: [],
    // A provider may send multiple partial-refund events. The status remains
    // REFUNDED while the ledger's cumulative refundedAmount increases.
    REFUNDED: [],
  };

  if (legal[current].includes(next)) return "apply";

  // A lower-priority status arriving after a forward transition is harmless.
  const rank: Record<PaymentAttemptStatus, number> = {
    PENDING: 0,
    AUTHORIZED: 1,
    SETTLED: 2,
    REFUNDED: 3,
    EXPIRED: 0,
    CANCELLED: 0,
    FAILED: 0,
  };
  if (rank[next] <= rank[current]) return "ignore";
  return "invalid";
}

export function isPaymentAttemptActive(
  status: PaymentAttemptStatus,
  expiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(status)) return false;
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

export function calculateRefundedAmount(input: {
  paidAmount: number;
  currentRefundedAmount: number;
  cumulativeRefundedAmount?: unknown;
  incrementalRefundAmount?: unknown;
  fullRefund?: boolean;
}): number {
  const paidAmount = Math.max(0, Math.round(input.paidAmount));
  const current = Math.max(0, Math.round(input.currentRefundedAmount));
  if (input.fullRefund) return paidAmount;

  const cumulative = Number(input.cumulativeRefundedAmount);
  if (Number.isFinite(cumulative)) {
    return Math.min(paidAmount, Math.max(current, Math.round(cumulative)));
  }

  const incremental = Number(input.incrementalRefundAmount);
  if (Number.isFinite(incremental)) {
    return Math.min(paidAmount, current + Math.max(0, Math.round(incremental)));
  }
  return current;
}

export function isFullyRefunded(paidAmount: number, refundedAmount: number): boolean {
  return Math.max(0, Math.round(refundedAmount)) >= Math.max(0, Math.round(paidAmount));
}

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}
