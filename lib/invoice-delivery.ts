import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const LOCAL_SHARE_SECRET = "invosmart-local-invoice-share-secret";

export type InvoiceDeliveryStatus = "sent" | "failed";

export type InvoiceDeliveryLogEntry = {
  to: string;
  status: InvoiceDeliveryStatus;
  attempt: number;
  sentAt?: string;
  failedAt?: string;
  messageId?: string;
  error?: string;
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

    const status: InvoiceDeliveryStatus = candidate.status === "failed" ? "failed" : "sent";
    const attempt =
      typeof candidate.attempt === "number" && Number.isSafeInteger(candidate.attempt) && candidate.attempt > 0
        ? candidate.attempt
        : index + 1;

    return [{
      to: candidate.to,
      status,
      attempt,
      ...(typeof candidate.sentAt === "string" ? { sentAt: candidate.sentAt } : {}),
      ...(typeof candidate.failedAt === "string" ? { failedAt: candidate.failedAt } : {}),
      ...(typeof candidate.messageId === "string" ? { messageId: candidate.messageId } : {}),
      ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
    }];
  });
};

export const appendInvoiceDeliveryLog = (
  value: unknown,
  entry: InvoiceDeliveryLogEntry,
) => [...parseInvoiceDeliveryLog(value), entry].slice(-50);
