import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const LOCAL_SHARE_SECRET = "invosmart-local-invoice-share-secret";

/**
 * Delivery state is intentionally kept in the legacy Json field for now. The
 * values are provider-neutral so Resend events can be consumed without
 * leaking provider-specific state into the invoice model.
 */
export type InvoiceDeliveryStatus =
  | "accepted"
  | "sent"
  | "delivered"
  | "delayed"
  | "failed"
  | "bounced"
  | "complained"
  | "suppressed";

export const MAX_EMAIL_RETRIES = 3;
export const MAX_EMAIL_ATTEMPTS = MAX_EMAIL_RETRIES + 1;

const EMAIL_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
] as const;

export type InvoiceDeliveryLogEntry = {
  to: string;
  status: InvoiceDeliveryStatus;
  attempt: number;
  acceptedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  delayedAt?: string;
  failedAt?: string;
  bouncedAt?: string;
  complainedAt?: string;
  suppressedAt?: string;
  messageId?: string;
  providerStatus?: string;
  providerEventId?: string;
  providerEventIds?: string[];
  error?: string;
  retryable?: boolean;
  nextRetryAt?: string;
};

const statusValues = new Set<InvoiceDeliveryStatus>([
  "accepted",
  "sent",
  "delivered",
  "delayed",
  "failed",
  "bounced",
  "complained",
  "suppressed",
]);

/** Normalize old and provider-specific values into our stable lifecycle. */
export const normalizeInvoiceDeliveryStatus = (value: unknown): InvoiceDeliveryStatus => {
  if (typeof value !== "string") return "sent";
  const normalized = value.trim().toLowerCase();
  if (statusValues.has(normalized as InvoiceDeliveryStatus)) {
    return normalized as InvoiceDeliveryStatus;
  }
  if (["email.sent", "provider_sent"].includes(normalized)) return "sent";
  if (["email.delivered", "provider_delivered"].includes(normalized)) return "delivered";
  if (["email.delivery_delayed", "delivery_delayed"].includes(normalized)) return "delayed";
  if (["email.bounced", "bounce"].includes(normalized)) return "bounced";
  if (["email.complained", "complaint"].includes(normalized)) return "complained";
  if (["email.suppressed", "suppression"].includes(normalized)) return "suppressed";
  if (["email.failed", "error"].includes(normalized)) return "failed";
  // Existing records used `sent`; unknown legacy values remain readable as it.
  return "sent";
};

/** Convert Resend webhook event names to the provider-neutral lifecycle. */
export const normalizeResendEventStatus = (eventType: unknown): InvoiceDeliveryStatus | null => {
  if (typeof eventType !== "string") return null;
  switch (eventType.trim().toLowerCase()) {
    case "email.sent":
      return "sent";
    case "email.delivered":
      return "delivered";
    case "email.delivery_delayed":
      return "delayed";
    case "email.failed":
      return "failed";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    case "email.suppressed":
      return "suppressed";
    default:
      return null;
  }
};

/**
 * Classify provider failures without relying on a concrete SDK error class.
 * Retryable failures are deliberately conservative: validation and recipient
 * errors must not create repeated sends, while rate limits, outages, and
 * network failures can be retried by a later request/job.
 */
export type EmailFailureClassification = {
  retryable: boolean;
  statusCode?: number;
  reason: string;
};

const readErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as Record<string, unknown>;
  const values = [candidate.statusCode, candidate.status, candidate.status_code];
  for (const value of values) {
    const status = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return undefined;
};

const readErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
};

export const classifyEmailFailure = (error: unknown): EmailFailureClassification => {
  const statusCode = readErrorStatus(error);
  const reason = readErrorMessage(error).slice(0, 240);
  const transientStatus = statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429 ||
    (typeof statusCode === "number" && statusCode >= 500);
  const transientMessage = /timeout|timed out|network|socket|econn|temporar|unavailable|rate limit|fetch failed/i.test(reason);
  return { retryable: transientStatus || transientMessage, ...(statusCode ? { statusCode } : {}), reason };
};

/** Return the bounded delay after a failed attempt, or null when exhausted. */
export const getEmailRetryDelayMs = (failedAttempt: number): number | null => {
  if (!Number.isSafeInteger(failedAttempt) || failedAttempt < 1 || failedAttempt > EMAIL_RETRY_DELAYS_MS.length) {
    return null;
  }
  return EMAIL_RETRY_DELAYS_MS[failedAttempt - 1];
};

export const getNextEmailRetryAt = (failedAttempt: number, now = new Date()): string | null => {
  const delay = getEmailRetryDelayMs(failedAttempt);
  if (delay === null) return null;
  return new Date(now.getTime() + delay).toISOString();
};

export type InvoiceEmailRetryState = {
  nextAttempt: number;
  retryAt: string | null;
  retryable: boolean;
  exhausted: boolean;
};

/** Determine whether a recipient is currently eligible for another send. */
export const getInvoiceEmailRetryState = (
  value: unknown,
  recipient: string,
): InvoiceEmailRetryState => {
  const normalizedRecipient = recipient.trim().toLowerCase();
  const entries = parseInvoiceDeliveryLog(value)
    .filter((entry) => entry.to.trim().toLowerCase() === normalizedRecipient)
    .sort((left, right) => left.attempt - right.attempt);
  const last = entries.at(-1);
  const nextAttempt = (last?.attempt ?? 0) + 1;
  if (!last || last.status !== "failed") {
    return { nextAttempt, retryAt: null, retryable: true, exhausted: false };
  }

  const retryAt = last.nextRetryAt || null;
  const exhausted = !last.retryable || nextAttempt > MAX_EMAIL_ATTEMPTS;
  return {
    nextAttempt,
    retryAt,
    retryable: last.retryable === true,
    exhausted,
  };
};

const statusRank: Record<InvoiceDeliveryStatus, number> = {
  accepted: 10,
  delayed: 20,
  sent: 30,
  delivered: 40,
  failed: 50,
  bounced: 60,
  complained: 60,
  suppressed: 60,
};

const terminalStatuses = new Set<InvoiceDeliveryStatus>(["bounced", "complained", "suppressed"]);

const shouldAdvanceStatus = (current: InvoiceDeliveryStatus, next: InvoiceDeliveryStatus) => {
  if (current === next) return true;
  if (terminalStatuses.has(current)) return false;
  if (terminalStatuses.has(next)) return true;
  if (current === "delivered") return false;
  if (current === "failed") return false;
  return statusRank[next] > statusRank[current];
};

export type InvoiceDeliveryStatusUpdate = {
  status: InvoiceDeliveryStatus;
  messageId?: string;
  alternateMessageId?: string;
  recipient?: string;
  providerStatus?: string;
  providerEventId?: string;
  occurredAt?: string;
  error?: string;
  retryable?: boolean;
  nextRetryAt?: string;
};

export type InvoiceDeliveryUpdateResult = {
  entries: InvoiceDeliveryLogEntry[];
  matched: boolean;
  duplicate: boolean;
};

const timestampField: Partial<Record<InvoiceDeliveryStatus, keyof InvoiceDeliveryLogEntry>> = {
  accepted: "acceptedAt",
  sent: "sentAt",
  delayed: "delayedAt",
  delivered: "deliveredAt",
  failed: "failedAt",
  bounced: "bouncedAt",
  complained: "complainedAt",
  suppressed: "suppressedAt",
};

/** Apply a signed provider update idempotently and never regress a message. */
export const applyInvoiceDeliveryStatusUpdate = (
  value: unknown,
  update: InvoiceDeliveryStatusUpdate,
): InvoiceDeliveryUpdateResult => {
  const entries = parseInvoiceDeliveryLog(value);
  if (update.providerEventId && entries.some((entry) =>
    entry.providerEventId === update.providerEventId || entry.providerEventIds?.includes(update.providerEventId as string))) {
    return { entries, matched: true, duplicate: true };
  }

  const recipient = update.recipient?.trim().toLowerCase();
  const messageIds = [update.messageId, update.alternateMessageId].filter((value): value is string => Boolean(value));
  const exactIndex = messageIds.length
    ? entries.findIndex((entry) => Boolean(entry.messageId && messageIds.includes(entry.messageId)))
    : -1;
  // For legacy entries without provider IDs, prefer the newest active attempt
  // for the recipient so a delayed webhook cannot mutate an older send.
  const recipientIndex = recipient
    ? entries.findLastIndex((entry) => entry.to.trim().toLowerCase() === recipient && !terminalStatuses.has(entry.status))
    : -1;
  const index = exactIndex >= 0 ? exactIndex : recipientIndex;
  if (index < 0) return { entries, matched: false, duplicate: false };

  const current = entries[index];
  const nextStatus = normalizeInvoiceDeliveryStatus(update.status);
  if (!shouldAdvanceStatus(current.status, nextStatus)) {
    // Persist the event id even for an out-of-order event so a replay remains
    // idempotent without regressing the already-observed state.
    const providerEventIds = update.providerEventId
      ? [...new Set([...(current.providerEventIds || []), update.providerEventId])].slice(-20)
      : current.providerEventIds;
    entries[index] = {
      ...current,
      ...(update.providerEventId ? { providerEventId: update.providerEventId } : {}),
      ...(providerEventIds?.length ? { providerEventIds } : {}),
    };
    return { entries, matched: true, duplicate: false };
  }

  const timestamp = update.occurredAt || new Date().toISOString();
  const field = timestampField[nextStatus];
  const providerEventIds = update.providerEventId
    ? [...new Set([...(current.providerEventIds || []), update.providerEventId])].slice(-20)
    : current.providerEventIds;
  entries[index] = {
    ...current,
    status: nextStatus,
    ...(update.messageId ? { messageId: update.messageId } : {}),
    ...(update.providerStatus ? { providerStatus: update.providerStatus } : {}),
    ...(update.providerEventId ? { providerEventId: update.providerEventId } : {}),
    ...(providerEventIds?.length ? { providerEventIds } : {}),
    ...(field ? { [field]: timestamp } : {}),
    ...(update.error ? { error: update.error } : {}),
    ...(typeof update.retryable === "boolean" ? { retryable: update.retryable } : {}),
    ...(update.nextRetryAt ? { nextRetryAt: update.nextRetryAt } : {}),
  };
  return { entries, matched: true, duplicate: false };
};

const getShareSecret = () => {
  const configured = process.env.INVOICE_SHARE_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;

  // A development fallback keeps local previews and tests usable. Production
  // must always provide a secret so links cannot be forged after deployment.
  if (process.env.NODE_ENV === "production") {
    throw new Error("INVOICE_SHARE_SECRET or NEXTAUTH_SECRET must be configured in production");
  }
  return LOCAL_SHARE_SECRET;
};

const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const sign = (payload: string) =>
  createHmac("sha256", getShareSecret()).update(payload).digest("base64url");

/** Create a stateless, tamper-evident invoice access token. */
export const createInvoiceShareToken = (
  invoiceId: string,
  expiresInSeconds = DEFAULT_EXPIRY_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
) => {
  if (!invoiceId || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("Invalid invoice share token input");
  }

  const payload = encode(
    JSON.stringify({
      v: 1,
      id: invoiceId,
      exp: nowSeconds + Math.floor(expiresInSeconds),
    }),
  );
  return `${payload}.${sign(payload)}`;
};

export type VerifiedInvoiceShareToken = {
  invoiceId: string;
  expiresAt: number;
};

/** Verify signature, invoice binding, and expiry without throwing on bad input. */
export const verifyInvoiceShareToken = (
  token: string | null | undefined,
  invoiceId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedInvoiceShareToken | null => {
  if (!token || !invoiceId) return null;

  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature || token.split(".").length !== 2) return null;

    const expected = Buffer.from(sign(payload), "base64url");
    const received = Buffer.from(signature, "base64url");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      return null;
    }

    const parsed = JSON.parse(decode(payload)) as { v?: unknown; id?: unknown; exp?: unknown };
    if (
      parsed.v !== 1 ||
      parsed.id !== invoiceId ||
      typeof parsed.exp !== "number" ||
      !Number.isSafeInteger(parsed.exp) ||
      parsed.exp <= nowSeconds
    ) {
      return null;
    }

    return { invoiceId, expiresAt: parsed.exp };
  } catch {
    return null;
  }
};

export const buildInvoiceShareUrl = (baseUrl: string, invoiceId: string, token: string) => {
  const url = new URL(`/share/${encodeURIComponent(invoiceId)}`, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
};

/** Normalize the legacy Json emailLog field and preserve old entries. */
export const parseInvoiceDeliveryLog = (value: unknown): InvoiceDeliveryLogEntry[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.to !== "string" || !candidate.to.trim()) return [];

    const status = normalizeInvoiceDeliveryStatus(candidate.status ?? candidate.providerStatus);
    const attempt =
      typeof candidate.attempt === "number" && Number.isSafeInteger(candidate.attempt) && candidate.attempt > 0
        ? candidate.attempt
        : index + 1;

    return [{
      to: candidate.to,
      status,
      attempt,
      ...(typeof candidate.acceptedAt === "string" ? { acceptedAt: candidate.acceptedAt } : {}),
      ...(typeof candidate.sentAt === "string" ? { sentAt: candidate.sentAt } : {}),
      ...(typeof candidate.deliveredAt === "string" ? { deliveredAt: candidate.deliveredAt } : {}),
      ...(typeof candidate.delayedAt === "string" ? { delayedAt: candidate.delayedAt } : {}),
      ...(typeof candidate.failedAt === "string" ? { failedAt: candidate.failedAt } : {}),
      ...(typeof candidate.bouncedAt === "string" ? { bouncedAt: candidate.bouncedAt } : {}),
      ...(typeof candidate.complainedAt === "string" ? { complainedAt: candidate.complainedAt } : {}),
      ...(typeof candidate.suppressedAt === "string" ? { suppressedAt: candidate.suppressedAt } : {}),
      ...(typeof candidate.messageId === "string" ? { messageId: candidate.messageId } : {}),
      ...(typeof candidate.providerStatus === "string" ? { providerStatus: candidate.providerStatus } : {}),
      ...(typeof candidate.providerEventId === "string" ? { providerEventId: candidate.providerEventId } : {}),
      ...(Array.isArray(candidate.providerEventIds)
        ? { providerEventIds: candidate.providerEventIds.filter((item): item is string => typeof item === "string").slice(-20) }
        : {}),
      ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
      ...(typeof candidate.retryable === "boolean" ? { retryable: candidate.retryable } : {}),
      ...(typeof candidate.nextRetryAt === "string" ? { nextRetryAt: candidate.nextRetryAt } : {}),
    }];
  });
};

export const appendInvoiceDeliveryLog = (
  value: unknown,
  entry: InvoiceDeliveryLogEntry,
) => [...parseInvoiceDeliveryLog(value), entry].slice(-50);
